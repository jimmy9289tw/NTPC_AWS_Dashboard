"""Cloud-native XLSX report, using Open XML with no executable formulas.

The Lambda runtime has no desktop artifact-tool runtime. This server component
therefore emits standard OOXML directly; every issue is included without a fixed
template row limit. It never imports spreadsheet edits as approval decisions.
"""
import io
import json
import os
import zipfile
from xml.sax.saxutils import escape
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError


def col(n):
    value = ''
    while n:
        n, digit = divmod(n - 1, 26)
        value = chr(65 + digit) + value
    return value


def cell(value, ref, style=0):
    # Explicit inline strings prevent =,+,-,@ input from becoming formulas.
    text = str(value if value is not None else '')
    text = ''.join(c for c in text if ord(c) >= 32 or c in '\n\t')
    if len(text) > 32767:
        raise ValueError('單一欄位超過 Excel 限制；保留案件並回報產表失敗')
    if isinstance(value, (int, float)):
        return f'<c r="{ref}" s="{style}" t="n"><v>{value}</v></c>'
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>'


def sheet(rows, widths):
    columns = ''.join(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>' for i, width in enumerate(widths, 1))
    body = []
    for r, row in enumerate(rows, 1):
        height = 30 if r == 1 else max(30, min(140, max((len(str(x)) // 24 + 1) for x in row) * 20))
        body.append(f'<row r="{r}" ht="{height}" customHeight="1">' + ''.join(cell(v, f'{col(c)}{r}', 1 if r == 1 else 0) for c, v in enumerate(row, 1)) + '</row>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
            f'<cols>{columns}</cols><sheetData>{"".join(body)}</sheetData>'
            f'<autoFilter ref="A1:{col(len(widths))}{len(rows)}"/>'
            '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>'
            '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>')


def workbook(case):
    candidate = case.get('candidate') or {}
    approval = case.get('approval') or {}
    summary = [['案件項目', '系統紀錄'], ['案件編號', case['case_id']],
               ['案件修訂', case['revision']], ['資料管線', case['pipeline']],
               ['狀態', case['status']], ['建立時間（UTC）', case['created_at']],
               ['更新時間（UTC）', case['updated_at']],
               ['问题數', len(case.get('issues', []))],
               ['原有效版本', json.dumps(case.get('baseline', {}).get('pointer'), ensure_ascii=False)],
               ['候選清冊 SHA-256', candidate.get('manifest_sha256', '尚無完整復驗候選版本')],
               ['復驗執行編號', candidate.get('run_id', '尚未取得')],
               ['簽核身分', approval.get('actor', '尚未簽核')],
               ['簽核時間（UTC）', approval.get('at', '')],
               ['簽核理由', approval.get('reason', '')],
               ['發布回執', json.dumps(case.get('publication_receipt'), ensure_ascii=False)],
               ['操作方式', '請由管理者網站受理、退回或簽核。修改本 Excel 不會改變伺服器狀態，也不會發布資料。'],
               ['資料不足', '中途失敗尚未取得的檢查結果不等於通過；未取得的值不填零。']]
    summary[7][0] = '問題數'
    issues = [['序號', '等級', '規則', '範圍', '預期結果', '實際結果', '證據', '處理狀態', '復驗執行編號']]
    for n, issue in enumerate(case.get('issues', []), 1):
        issues.append([n, issue.get('severity'), issue.get('rule'), issue.get('scope'),
                       issue.get('expected'), issue.get('actual'), issue.get('evidence'),
                       issue.get('resolution'), issue.get('retest_run_id', '尚未取得')])
    history = [['修訂', '時間（UTC）', '事件', '具名身分', '理由', '候選 SHA-256']]
    for row in case.get('history', []):
        history.append([row['revision'], row['at'], row['event'], row['actor'], row.get('reason'), row.get('candidate_sha256')])
    names = ['管理者查核表', '問題明細', '處置與簽核紀錄']
    sheets = [(summary, [28, 110]), (issues, [8, 14, 24, 36, 40, 60, 60, 34, 32]), (history, [8, 30, 32, 56, 80, 72])]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        def write(name, data):
            # Fixed timestamps make duplicate report retries byte-identical.
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data.encode('utf-8'))
        write('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, 4)) + '</Types>')
        write('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        write('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + ''.join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(names, 1)) + '</sheets></workbook>')
        write('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, 4)) + '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        write('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Microsoft JhengHei"/><color rgb="FF12384D"/></font><font><b/><sz val="12"/><name val="Microsoft JhengHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF117C80"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
        for i, (rows, widths) in enumerate(sheets, 1):
            write(f'xl/worksheets/sheet{i}.xml', sheet(rows, widths))
    return buf.getvalue()


def process(record):
    s3 = boto3.client('s3'); sns = boto3.client('sns')
    bucket = os.environ['DATA_BUCKET']; account = os.environ['DATA_ACCOUNT']; prefix = os.environ['REVIEW_PREFIX']
    message = json.loads(record['body']); key = message['snapshot_key']
    if not key.startswith(prefix + 'cases/') or '..' in key or '\\' in key:
        raise ValueError('不允許的案件路徑')
    obj = s3.get_object(Bucket=bucket, Key=key, ExpectedBucketOwner=account)
    with obj['Body'] as stream:
        case = json.loads(stream.read())
    base = f"{prefix}reports/{case['case_id']}/r{case['revision']}/"
    existing = s3.list_objects_v2(Bucket=bucket, Prefix=base + 'delivery.json', MaxKeys=1,
                                  ExpectedBucketOwner=account)
    if any(x['Key'] == base + 'delivery.json' for x in existing.get('Contents', [])):
        return
    try:
        s3.put_object(Bucket=bucket, Key=base + '查核表.xlsx', Body=workbook(case),
                      ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      ServerSideEncryption='AES256', ExpectedBucketOwner=account, IfNoneMatch='*')
    except ClientError as e:
        if e.response['Error']['Code'] != 'PreconditionFailed':
            raise
    confirmed = False
    args = {'TopicArn': os.environ['TOPIC_ARN']}
    while True:
        page = sns.list_subscriptions_by_topic(**args)
        confirmed |= any(x.get('Endpoint') == os.environ['NOTIFICATION_EMAIL'] and x.get('SubscriptionArn', '').startswith('arn:') for x in page['Subscriptions'])
        if not page.get('NextToken'):
            break
        args['NextToken'] = page['NextToken']
    if not confirmed:
        # Retry with SQS/DLQ/reconciliation after the user confirms subscription.
        raise RuntimeError('EMAIL_SUBSCRIPTION_PENDING；查核表已保存，未宣稱寄達')
    issue_lines = '\n'.join(f"- {x['rule']}：{x['actual'][:180]}" for x in case['issues'][:3])
    sent = sns.publish(TopicArn=os.environ['TOPIC_ARN'], Subject='新北青年資料查核｜' + case['status'],
                       Message=f"案件：{case['case_id']}\n修訂：{case['revision']}\n資料管線：{case['pipeline']}\n狀態：{case['status']}\n問題總數：{len(case['issues'])}\n{issue_lines}\n\n請登入管理者入口查阅完整問題與下載查核表：\n{os.environ['REVIEW_URL']}\n\n受理、已讀或未回覆均不代表核可。此郵件沒有發布權限。".replace('查阅', '查閱'))
    receipt = {'sns_message_id': sent['MessageId'], 'at': datetime.now(timezone.utc).isoformat(),
               'status': 'SNS_ACCEPTED', 'meaning': 'SNS 接受寄送，不等於使用者已收信或已讀'}
    s3.put_object(Bucket=bucket, Key=base + 'delivery.json', Body=json.dumps(receipt).encode(),
                  ServerSideEncryption='AES256', ExpectedBucketOwner=account, IfNoneMatch='*')


def handler(event, context):
    failures = []
    for record in event['Records']:
        try:
            process(record)
        except Exception as e:
            print(json.dumps({'message_id': record['messageId'], 'error_type': type(e).__name__}))
            failures.append({'itemIdentifier': record['messageId']})
    return {'batchItemFailures': failures}
