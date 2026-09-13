"""Named-admin portal. CloudFront network guard + JWT + Cognito identity."""
import base64
import hmac
import json
import os
from pathlib import Path
import boto3
from botocore.exceptions import ClientError, ReadTimeoutError
from botocore.config import Config


def reply(body, status=200, mime='application/json; charset=utf-8'):
    if not isinstance(body, bytes):
        body = (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode()
    login = os.environ.get('LOGIN_ORIGIN', '')
    headers = {'content-type': mime, 'cache-control': 'private, no-store',
               'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
               'strict-transport-security': 'max-age=31536000',
               'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' " + login + "; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"}
    return {'statusCode': status, 'headers': headers,
            'isBase64Encoded': True, 'body': base64.b64encode(body).decode()}


def handler(event, context):
    headers = {k.lower(): v for k, v in event.get('headers', {}).items()}
    if not os.environ.get('ORIGIN_SECRET') or not hmac.compare_digest(headers.get('x-ntpc-origin', ''), os.environ['ORIGIN_SECRET']):
        return reply({'error': '請從正式管理者入口進入。'}, 403)
    if headers.get('x-ntpc-viewer-ip') not in os.environ['ALLOW_IPS'].split(','):
        return reply({'error': '此入口限本案指定網路位置。'}, 403)
    path = event.get('rawPath', '')
    method = event.get('requestContext', {}).get('http', {}).get('method')
    if method == 'GET' and path in ('/review', '/review/'):
        return reply(Path('review-ui.html').read_bytes(), mime='text/html; charset=utf-8')
    if method == 'GET' and path == '/review/app.js':
        return reply(Path('review-ui.js').read_bytes(), mime='text/javascript; charset=utf-8')
    if method == 'GET' and path == '/review/config':
        return reply({'login_origin': os.environ['LOGIN_ORIGIN'], 'client_id': os.environ['CLIENT_ID'],
                      'redirect_uri': os.environ['REVIEW_URL'], 'scope': 'openid email ntpc-review/access aws.cognito.signin.user.admin'})
    claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
    if claims.get('sub') != os.environ['ADMIN_SUB'] or claims.get('token_use') != 'access' or claims.get('client_id') != os.environ['CLIENT_ID']:
        return reply({'error': '請使用本案管理者身分登入。'}, 403)
    table = boto3.resource('dynamodb').Table(os.environ['CASE_TABLE'])
    s3 = boto3.client('s3')
    try:
        if path == '/api/review/cases' and method == 'GET':
            # No issue text in the list; authoritative details are immutable S3 snapshots.
            args = {}; items = []
            while True:
                page = table.scan(**args)
                items.extend({k: str(v) if k == 'revision' else v for k, v in x.items() if k != 'pk'} for x in page.get('Items', []) if x['pk'].startswith('CASE#') and x.get('issue_count', 0) > 0)
                if 'LastEvaluatedKey' not in page:
                    break
                args['ExclusiveStartKey'] = page['LastEvaluatedKey']
            # Decimal issue counts are explicitly normalized for JSON.
            for item in items:
                item['issue_count'] = int(item['issue_count'])
            return reply({'cases': sorted(items, key=lambda x: x['updated_at'], reverse=True)})
        if path.startswith('/api/review/cases/') and method == 'GET':
            rest = path.removeprefix('/api/review/cases/')
            download = rest.endswith('/report')
            case_id = rest.removesuffix('/report')
            if '/' in case_id or '..' in case_id:
                return reply({'error': '案件編號無效'}, 400)
            item = table.get_item(Key={'pk': 'CASE#' + case_id}, ConsistentRead=True).get('Item')
            if not item:
                return reply({'error': '找不到案件'}, 404)
            key = item['snapshot_key']
            if download:
                key = f"{os.environ['REVIEW_PREFIX']}reports/{case_id}/r{item['revision']}/查核表.xlsx"
            r = s3.get_object(Bucket=os.environ['DATA_BUCKET'], Key=key,
                              ExpectedBucketOwner=os.environ['DATA_ACCOUNT'])
            with r['Body'] as stream:
                data = stream.read()
            if len(data) > 4400000:
                return reply({'error': '案件檔案超過單次下載上限，請由受控 S3 入口取得。'}, 413)
            response = reply(data, mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' if download else 'application/json; charset=utf-8')
            if download:
                response['headers']['content-disposition'] = f'attachment; filename="{case_id}-r{item["revision"]}.xlsx"'
            return response
        if path == '/api/review/decision' and method == 'POST':
            raw = event.get('body', '')
            if event.get('isBase64Encoded'):
                raw = base64.b64decode(raw).decode()
            if len(raw) > 12000:
                return reply({'error': '請求過長'}, 413)
            submitted = json.loads(raw)
            wanted = ('case_id', 'revision', 'decision', 'reason', 'manifest_sha256')
            payload = {k: submitted.get(k) for k in wanted}
            payload.update(action='decision', access_token=headers.get('authorization', '').removeprefix('Bearer '))
            try:
                r = boto3.client('lambda', config=Config(connect_timeout=4, read_timeout=20,
                    retries={'max_attempts': 0})).invoke(FunctionName=os.environ['CONTROL_FUNCTION'],
                                                       Payload=json.dumps(payload).encode())
            except ReadTimeoutError:
                return reply({'status': 'RESULT_PENDING', 'message': '處置結果尚未確認，請重新整理案件；不要重複提交。'}, 202)
            result = json.loads(r['Payload'].read())
            if r.get('FunctionError'):
                # Core errors are deliberately concise and contain no credentials.
                return reply({'error': result.get('errorMessage', '處置尚未完成，請重新讀取案件')}, 409)
            return reply(result)
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return reply({'error': '查核表尚在產生，案件紀錄已保存，請稍後再試。'}, 409)
        print(json.dumps({'event': 'REVIEW_API_ERROR', 'error_type': type(e).__name__}))
        return reply({'error': '系統暫時無法完成要求。'}, 503)
    except (ValueError, TypeError):
        return reply({'error': '請求格式錯誤'}, 400)
    return reply({'error': '找不到此操作'}, 404)
