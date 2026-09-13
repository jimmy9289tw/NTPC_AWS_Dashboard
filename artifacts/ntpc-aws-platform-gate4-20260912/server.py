"""CloudFront 專用來源；不接受使用者自報的 X-Forwarded-For。"""
import base64, gzip, hashlib, hmac, ipaddress, json, mimetypes, os, time
from pathlib import PurePosixPath
from urllib.parse import unquote
import boto3
from system_reader_v2 import SystemReader

BUCKET = os.environ.get('BUCKET', 'ntpc-youth-data-000000000000')
SITE_PREFIX = 'NTPC_Youth_System_V1_20260912/09_網站與完整原始碼/AWS_Gate4/web/'
ALLOW = set(os.environ.get('ALLOW_IPS', '192.0.2.1,192.0.2.2,192.0.2.3,192.0.2.4,192.0.2.5,192.0.2.6').split(','))
SECRET = os.environ.get('ORIGIN_SECRET', '')
s3 = boto3.client('s3', region_name='us-west-2')
CACHE = {}

def reply(body, status=200, mime='application/json; charset=utf-8', private=True):
    if not isinstance(body, bytes):
        body = (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode('utf-8')
    headers = {'content-type': mime, 'cache-control': 'private, no-store' if private else 'public, max-age=60',
               'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
               'strict-transport-security': 'max-age=31536000',
               'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"}
    if len(body) > 1024:
        body = gzip.compress(body)
        headers['content-encoding'] = 'gzip'
    if len(body) > 4400000:
        return reply({'error': '資料超過單次傳輸上限，請縮小範圍。'}, 413)
    return {'statusCode': status, 'headers': headers, 'isBase64Encoded': True, 'body': base64.b64encode(body).decode()}

def normalize(path):
    for _ in range(3):
        decoded = unquote(path)
        if decoded == path: break
        path = decoded
    if '\\' in path or '\x00' in path or '..' in PurePosixPath(path).parts or '//' in path:
        raise ValueError('invalid path')
    return path

def protected(path):
    return path == '/internal' or path.startswith('/internal/') or path.startswith('/api/export') or path.startswith('/api/roa')

def reader():
    if CACHE.get('until', 0) < time.time():
        # A new reader pins one validated manifest for all chart datasets in this cache generation.
        CACHE.clear()
        CACHE.update(reader=SystemReader(), until=time.time()+60)
    return CACHE['reader']

def dataset(name):
    r = reader()
    if name not in CACHE: CACHE[name] = r.load(name)
    return CACHE[name]

def lambda_handler(event, context):
    headers = {k.lower(): v for k, v in event.get('headers', {}).items()}
    if not SECRET or not hmac.compare_digest(headers.get('x-ntpc-origin', ''), SECRET):
        return reply({'error': '請從正式網站進入。'}, 403)
    try:
        path = normalize(event.get('rawPath', '/'))
        allowed = str(ipaddress.ip_address(headers.get('x-ntpc-viewer-ip', ''))) in ALLOW
    except ValueError:
        return reply({'error': '無效請求。'}, 400)
    if protected(path) and not allowed:
        return reply({'error': '此入口限指定網路位置。公開資料仍可使用。'}, 403)
    try:
        if path == '/auth/status':
            return reply({'authenticated': allowed, 'name': 'IP 白名單', 'role': 'decision' if allowed else 'viewer',
                          'permissions': {'viewPolicy': allowed, 'exportData': allowed}})
        if path.startswith('/auth/'):
            return reply({'error': '本網站不使用帳密或 Google 登入。'}, 404)
        if path == '/api/health':
            r = reader()
            return reply({'status': 'ok', 'ui': 'AWS V1.0', 'data': 'Gate3 驗證發布', 'source': '私有 S3', 'datasets': len(r.catalog['datasets']), 'ai': 'BEDROCK_NOVA_OFFICIAL_SOURCES' if os.environ.get('AI_QUEUE_URL') else 'NOT_ENABLED'})
        if path == '/api/bootstrap':
            names={'dashboard':'charts/g5-dashboard-data.json','industry':'charts/resident-employment-industry.json','wageIndustry':'charts/youth-industry-wage.json','monthly':'月人口_有效版本'}
            return reply({key:json.loads(dataset(name)) for key,name in names.items()})
        if path == '/api/export/authorize':
            return reply({'allowed': True})
        if path == '/api/monthly-population':
            data = json.loads(dataset('月人口_有效版本'))
            q = event.get('queryStringParameters') or {}
            age, sex, geo = q.get('ageBand', '18-35'), q.get('sex', '合計'), q.get('geography', '新北市')
            if age not in ['18-35','18-24','25-29','30-35'] or sex not in ['合計','男','女']:
                return reply({'error': '篩選條件無效。'}, 400)
            rows = [x for x in data['records'] if x['ageBand'] == age and x['sex'] == sex and x['geography'] == geo]
            lookup = {x['period']: x['population'] for x in rows}
            result = []
            for row in rows:
                y, m, n = row['year'], row['month'], row['population']
                previous = lookup.get(f'{y-1}12' if m == 1 else f'{y}{m-1:02d}')
                previous_year = lookup.get(f'{y-1}{m:02d}')
                result.append({**row, 'monthChange': (n/previous-1)*100 if previous else None, 'yearChange': (n/previous_year-1)*100 if previous_year else None})
            values = [x['population'] for x in rows]
            import math
            lo, hi = (min(values), max(values)) if values else (0, 1)
            step = 10**max(0, math.floor(math.log10(max(hi-lo, 1))))
            return reply({'rows': result, 'meta': data['meta'], 'scale': {'minimum': math.floor(lo/step)*step, 'maximum': math.ceil(hi/step)*step, 'rule': '同地區年齡性別採全部可用月份固定Y軸'}})
        if path == '/api/ask':
            if not os.environ.get('AI_QUEUE_URL'): return reply({'error':'AI 尚未啟用。'},503)
            if event.get('requestContext',{}).get('http',{}).get('method')!='POST': return reply({'error':'請使用 POST。'},405)
            try:
                from ai_chat import submit
                raw=event.get('body','')
                if event.get('isBase64Encoded'): raw=base64.b64decode(raw).decode('utf-8')
                if len(raw)>10000: return reply({'error':'問題內容過長。'},413)
                body=json.loads(raw)
                result,status=submit(body,headers,allowed,SECRET,json.loads(dataset('charts/g5-dashboard-data.json'))['geographies'])
                return reply(result,status)
            except PermissionError as e: return reply({'error':str(e)},403)
            except (ValueError,TypeError) as e: return reply({'error':str(e) if not isinstance(e,json.JSONDecodeError) else '請求格式無效。'},400)
        if path.startswith('/api/ask/'):
            try:
                from ai_chat import poll
                result,status=poll(path.removeprefix('/api/ask/'),headers,allowed,SECRET)
                return reply(result,status)
            except ValueError as e: return reply({'error':str(e)},400)
        if path == '/api/roa/rules':
            return reply(json.loads(open('roa-rules.json', encoding='utf-8').read()))
        if path == '/api/roa/context':
            return reply(json.loads(open('roa-context.json', encoding='utf-8').read()))
        if path.startswith('/data/'):
            name = path.removeprefix('/data/')
            logical = 'charts/' + name
            if logical in reader().catalog['datasets']:
                return reply(dataset(logical), mime='application/json; charset=utf-8')
            if name == 'monthly-population.json': return reply(dataset('月人口_有效版本'))
            if name != 'ntpc-districts.geojson': return reply({'error': '資料未開放。'}, 404)
        relative = 'index.html' if path == '/' else 'internal/index.html' if path in ['/internal','/internal/'] else path.lstrip('/')
        # Never expose arbitrary files in the data package or source repository.
        valid = relative in ['index.html', 'internal/index.html','favicon.svg','internal/favicon.svg','data/ntpc-districts.geojson'] or relative.startswith(('assets/', 'internal/assets/', 'icons/', 'internal/icons/'))
        if not valid: return reply({'error': '找不到頁面。'}, 404)
        response = s3.get_object(Bucket=BUCKET, Key=SITE_PREFIX+relative)
        body = response['Body'].read()
        return reply(body, mime=mimetypes.guess_type(relative)[0] or 'application/octet-stream', private=protected(path))
    except Exception as error:
        print(json.dumps({'event': 'request_failed', 'path': path, 'error_type': type(error).__name__}))
        return reply({'error': '資料暫時無法載入，請稍後再試。'}, 503)
