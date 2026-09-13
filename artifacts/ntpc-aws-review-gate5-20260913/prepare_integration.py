"""Prepare reviewable ETL patches without overwriting the deployed baseline."""
from pathlib import Path
import difflib
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parent
G2 = ROOT.parent / 'ntpc-aws-etl-gate2-20260912'
G3 = ROOT.parent / 'ntpc-aws-etl-gate3-20260912'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('既有 ETL 程式已變更，須重新檢查補丁：' + old[:90])
    return text.replace(old, new, 1)


def build():
    out = ROOT / 'prepared'
    (out / 'monthly' / 'etl').mkdir(parents=True, exist_ok=True)
    (out / 'annual').mkdir(parents=True, exist_ok=True)
    patches = []
    hashes = {}
    for source in (G2 / 'etl').glob('*.py'):
        original = source.read_text(encoding='utf-8')
        changed = original
        if source.name == 'handler.py':
            changed = replace_once(changed, 'from .common import S3Store',
                'from .common import S3Store\nfrom review_client import monthly_store, ReviewRequired\nS3Store = monthly_store(S3Store)')
            changed = replace_once(changed,
                "    result=run(S3Store(os.environ['DATA_BUCKET'],os.environ['ETL_PREFIX'],os.environ['DATA_ACCOUNT']))",
                "    try:\n        result=run(S3Store(os.environ['DATA_BUCKET'],os.environ['ETL_PREFIX'],os.environ['DATA_ACCOUNT']))\n    except ReviewRequired as error:\n        return json.loads(str(error))")
        if source.name == 'monthly.py':
            changed = replace_once(changed, 'if changed or not previous:',
                "if changed or not previous or getattr(store,'review_pending',lambda:False)():")
            changed = replace_once(changed, "'checked_at':checked_at,'annual_window_unchanged':'110–114'",
                "'checked_at':checked_at,'review_run_id':run_id,'annual_window_unchanged':'110–114'")
        (out / 'monthly' / 'etl' / source.name).write_text(changed, encoding='utf-8')
        hashes[str(source)] = hashlib.sha256(source.read_bytes()).hexdigest()
        if changed != original:
            patches.extend(difflib.unified_diff(original.splitlines(True), changed.splitlines(True), str(source), 'prepared/monthly/etl/' + source.name))
    source = G3 / 'run_annual.py'
    original = source.read_text(encoding='utf-8'); changed = original
    changed = replace_once(changed, "ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'",
        "from review_client import annual_stage, annual_failure, ReviewRequired\nROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'")
    old = "    s3.put_object(Bucket=bucket,Key=pointer_key,Body=json.dumps(pointer).encode(),ServerSideEncryption='AES256',ExpectedBucketOwner=account,**({'IfMatch':old_etag} if old_etag else {'IfNoneMatch':'*'}))"
    changed = replace_once(changed, old,
        '    annual_stage(s3,bucket,account,prefix,manifest_key,body,pointer,metadata,old_etag)')
    changed = replace_once(changed, '    except Exception as e:report.update(',
        "    except ReviewRequired as e:report.update(status='REVIEW_REQUIRED',review=json.loads(str(e)),seconds=round(time.monotonic()-start,2))\n    except Exception as e:report.update(")
    changed = replace_once(changed, "    print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False))",
        "    if os.environ.get('DATA_BUCKET'):annual_failure(report)\n    print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False))")
    changed = replace_once(changed, "return 0 if report['status']=='PASS' else 1",
        "return 0 if report['status'] in ('PASS','REVIEW_REQUIRED') else 1")
    (out / 'annual' / 'run_annual.py').write_text(changed, encoding='utf-8')
    hashes[str(source)] = hashlib.sha256(source.read_bytes()).hexdigest()
    patches.extend(difflib.unified_diff(original.splitlines(True), changed.splitlines(True), str(source), 'prepared/annual/run_annual.py'))
    for folder in ('monthly', 'annual'):
        shutil.copyfile(ROOT / 'review_client.py', out / folder / 'review_client.py')
    # annual_failure deliberately depends only on its client adapter, not the controller package.
    (ROOT / 'integration.patch').write_text(''.join(patches), encoding='utf-8')
    (ROOT / 'baseline-hashes.json').write_text(json.dumps(hashes, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'status': 'PREPARED', 'baseline_files_preserved': True, 'patch': str(ROOT / 'integration.patch')}, ensure_ascii=False))


if __name__ == '__main__':
    build()
