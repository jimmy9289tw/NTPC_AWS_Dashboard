"""Scope-specific evidence for ROA explanation and context changes; no model API calls."""
from pathlib import Path
import datetime,json,subprocess,sys,hashlib
ROOT=Path(__file__).resolve().parent
NODE='C:/Users/jimmy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
checks={}
def run(name,args,cwd):
    p=subprocess.run(args,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=240)
    checks[name]={'exit_code':p.returncode,'output':p.stdout+p.stderr}
    print(name,'PASS' if p.returncode==0 else 'DIAGNOSTICS',flush=True)
run('backend',[sys.executable,'-X','utf8','-m','unittest','discover','-s','tests','-v'],ROOT)
run('roa_and_chart_regression',[NODE,'--import','./tests/aws-runtime-setup.mjs','--import','tsx','--test','tests/aws-ui-evidence.test.mts','tests/aws-roa.test.mts','tests/aws-roa-explanations.test.mts','tests/aws-roa-quadrants.test.mts','tests/aws-region-map.test.mts','tests/chart-transition.test.mts','tests/data-reading.test.mts','tests/wage-metrics.test.mjs'],ROOT/'dashboard')
run('typescript_diagnostics',[NODE,'node_modules/typescript/bin/tsc','--noEmit','--pretty','false'],ROOT/'dashboard')
for mode in ['public','internal']:
    run('build_'+mode,[NODE,'node_modules/vite/bin/vite.js','build','--config','vite.aws.config.mts','--configLoader','runner','--mode',mode],ROOT/'dashboard')
public=''.join(p.read_text(encoding='utf-8') for p in (ROOT/'dashboard/dist-public/assets').glob('*.js'))
checks['public_isolation']={'exit_code':0 if all(s not in public for s in ['/api/roa/context','點估計參考','先整理淡水青年住宅到轉乘點','ROA-CONTEXT-V1.1']) else 1}
new_diagnostics=[line for line in checks['typescript_diagnostics']['output'].splitlines() if any(name in line for name in ['aws-roa','ai-evidence-table','dimension-order','monthly-chart-layout','chart-transition'])]
checks['changed_modules_typecheck']={'exit_code':int(bool(new_diagnostics)),'diagnostics':new_diagnostics}
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'PASS' if all(v['exit_code']==0 for k,v in checks.items() if k!='typescript_diagnostics') else 'FAIL','checks':checks,'sourceCsvSha256':json.loads((ROOT/'roa-context.json').read_text(encoding='utf-8'))['sourceCsvSha256'],'note':'全專案仍有既有TypeScript診斷；本次ROA模組不得新增診斷。分級測試是程式正確性，不是政策效度驗證。'}
(ROOT/'roa-local-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
assert report['status']=='PASS'
