"""Review state machine. All mutating calls run in one serialized controller.

Storage adapter keeps immutable snapshots and compare-and-swap publication.
Notifications and spreadsheets are never authorization or publication signals.
"""
import copy
import hashlib
import json


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


class ReviewError(ValueError):
    pass


class Engine:
    def __init__(self, port):
        self.p = port

    def record(self, case, event, actor='SYSTEM', reason=''):
        case = copy.deepcopy(case)
        case['revision'] = case.get('revision', 0) + 1
        case['updated_at'] = self.p.now()
        case.setdefault('history', []).append({
            'at': case['updated_at'], 'event': event, 'actor': actor,
            'reason': reason, 'revision': case['revision'],
            'candidate_sha256': (case.get('candidate') or {}).get('manifest_sha256')})
        self.p.save(case)
        # A queue outage does not roll back the case or open its publication gate.
        # Reconciliation re-enqueues snapshots missing their delivery receipt.
        try:
            self.p.enqueue(case)
        except Exception:
            self.p.log('REPORT_QUEUE_PENDING', case['case_id'])
        return case

    def anomaly(self, request):
        pipeline = request['pipeline']
        issue = request['issue']
        event_id = request['event_id']
        if not issue.get('actual') or not issue.get('rule'):
            raise ReviewError('異常事件須有規則與實際結果')
        prior = self.p.event_case(pipeline, event_id)
        if prior:
            return prior
        case = self.p.active(pipeline)
        if case and case['status'] == 'PUBLISHING':
            self.resume(case)
            case = self.p.active(pipeline)
        if not case:
            case = {'case_id': pipeline + '-' + hashlib.sha256(event_id.encode()).hexdigest()[:20],
                    'pipeline': pipeline, 'status': 'OPEN', 'revision': 0,
                    'created_at': self.p.now(), 'issues': [], 'event_ids': [],
                    'candidate': None, 'baseline': self.p.current(pipeline),
                    'history': []}
        if event_id in case.get('event_ids', []):
            return case
        case['event_ids'].append(event_id)
        issue = {**issue, 'event_id': event_id, 'detected_at': self.p.now(),
                 'resolution': 'OPEN'}
        case['issues'].append(issue)
        case['status'] = 'OPEN'
        case['candidate'] = None
        case.pop('approval', None)
        return self.record(case, 'ANOMALY', reason=issue['actual'])

    def stage(self, request):
        pipeline = request['pipeline']
        # Re-read the entire immutable manifest and every referenced file.
        candidate = self.p.verify_candidate(request)
        observed = self.p.current(pipeline)
        if observed['pointer'] == candidate['pointer']:
            return {'status': 'PUBLISHED', 'pointer': candidate['pointer'], 'recovered': True}
        if observed['etag'] != candidate['baseline_etag']:
            raise ReviewError('有效版本已改變，須以最新版本重新執行 ETL')
        existing = self.p.active(pipeline)
        if existing and existing['status'] == 'PUBLISHING':
            self.resume(existing)
            existing = self.p.active(pipeline)
        if existing:
            if existing.get('candidate') == candidate and existing['status'] == 'READY_REVIEW':
                return {'status': 'REVIEW_REQUIRED', 'case_id': existing['case_id'],
                        'revision': existing['revision']}
            existing['candidate'] = candidate
            existing['baseline'] = self.p.current(pipeline)
            existing['status'] = 'READY_REVIEW'
            existing.pop('approval', None)
            for issue in existing['issues']:
                issue.update(resolution='RETEST_PASS_PENDING_REVIEW',
                             retest_run_id=candidate['run_id'])
            existing = self.record(existing, 'RETEST_PASS',
                                   reason='完整復驗通過；異常案件仍需具名簽核')
            return {'status': 'REVIEW_REQUIRED', 'case_id': existing['case_id'],
                    'revision': existing['revision']}
        # A clean batch has an immutable publication receipt but requires no human case.
        case = {'case_id': pipeline + '-clean-' + candidate['manifest_sha256'][:20],
                'pipeline': pipeline, 'status': 'PUBLISHING', 'revision': 0,
                'created_at': self.p.now(), 'candidate': candidate,
                'baseline': self.p.current(pipeline), 'issues': [], 'event_ids': [],
                'approval': {'actor': 'SYSTEM', 'at': self.p.now(),
                             'manifest_sha256': candidate['manifest_sha256'],
                             'reason': '無待辦異常案件，完整機器查核通過'}, 'history': []}
        # Never silently replace a newer pointer than the ETL validated against.
        if case['baseline']['etag'] != candidate['baseline_etag']:
            raise ReviewError('有效版本已改變，須以最新版本重新執行 ETL')
        case = self.record(case, 'CLEAN_PUBLICATION_PREPARED')
        return self.resume(case)

    def decision(self, request, actor):
        if not actor or actor == 'SYSTEM':
            raise ReviewError('必須使用具名管理者登入')
        case = self.p.case(request['case_id'])
        if not case or case['status'] in ('PUBLISHED', 'CLOSED_NO_CHANGE'):
            raise ReviewError('案件不存在或已結案')
        if request.get('revision') != case['revision']:
            raise ReviewError('案件已更新，請重新讀取')
        action = request['decision']
        reason = str(request.get('reason', '')).strip()
        if len(reason) < 5 or len(reason) > 2000:
            raise ReviewError('請填寫 5–2000 字處理理由')
        if case['status'] == 'PUBLISHING':
            raise ReviewError('發布處理中，請等待回執')
        states = {'ACKNOWLEDGE': 'ACKNOWLEDGED', 'RETURN': 'RETURNED',
                  'WAIT_SOURCE': 'WAIT_SOURCE', 'REJECT': 'REJECTED'}
        if action in states:
            if not (action == 'ACKNOWLEDGE' and case['status'] == 'READY_REVIEW'):
                case['status'] = states[action]
            case.pop('approval', None)
            return self.record(case, action, actor, reason)
        if action != 'APPROVE':
            raise ReviewError('不支援的處置')
        candidate = case.get('candidate')
        if case['status'] != 'READY_REVIEW' or not candidate:
            raise ReviewError('尚未有完整復驗通過的候選版本')
        if request.get('manifest_sha256') != candidate['manifest_sha256']:
            raise ReviewError('簽核資料雜湊不符')
        verified = self.p.verify_candidate(candidate)
        if verified != candidate:
            raise ReviewError('候選內容已變更，須重新復驗')
        if self.p.current(case['pipeline'])['etag'] != case['baseline']['etag']:
            raise ReviewError('有效版本已變更，請重新執行 ETL 與簽核')
        case['approval'] = {'actor': actor, 'at': self.p.now(), 'reason': reason,
                            'manifest_sha256': candidate['manifest_sha256']}
        case['status'] = 'PUBLISHING'
        case = self.record(case, 'APPROVE', actor, reason)
        return self.resume(case)

    def resume(self, case):
        if case['status'] != 'PUBLISHING':
            raise ReviewError('無待發布交易')
        c = case['candidate']
        if case['approval']['manifest_sha256'] != c['manifest_sha256']:
            raise ReviewError('核可版本不符')
        self.p.verify_candidate(c)
        current = self.p.current(case['pipeline'])
        # Recover a timeout after S3 commit and before the DynamoDB receipt.
        if current['pointer'] != c['pointer']:
            if current['etag'] != case['baseline']['etag']:
                case['status'] = 'CONFLICT'
                case.pop('approval', None)
                self.record(case, 'PUBLICATION_CONFLICT')
                raise ReviewError('版本競爭，保留目前有效版本')
            self.p.publish(case['pipeline'], c['pointer'], current['etag'])
        confirmed = self.p.current(case['pipeline'])
        if confirmed['pointer'] != c['pointer']:
            raise ReviewError('發布回讀不一致，等待對帳')
        case['status'] = 'PUBLISHED'
        case['publication_receipt'] = {'published_at': self.p.now(),
                                       'current_etag': confirmed['etag'],
                                       'manifest_sha256': c['manifest_sha256']}
        case = self.record(case, 'PUBLISHED')
        return {'status': 'PUBLISHED', 'case_id': case['case_id'],
                'pointer': c['pointer'], 'revision': case['revision']}
