"""Capture local tests and compiler diagnostics without altering source datasets."""
import json,subprocess,sys,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NODE='C:/Users/jimmy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
checks={}
def run(name,args,cwd):
    p=subprocess.run(args,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=240)
    checks[name]={'exit_code':p.returncode,'output':p.stdout+p.stderr}
    print(name,'PASS' if p.returncode==0 else 'DIAGNOSTICS',flush=True)
run('backend',[sys.executable,'-X','utf8','-m','unittest','discover','-s','tests','-v'],ROOT)
run('chart_regression',[NODE,'--import','./tests/aws-runtime-setup.mjs','--import','tsx','--test','tests/aws-roa.test.mts','tests/aws-region-map.test.mts','tests/chart-transition.test.mts','tests/data-reading.test.mts','tests/wage-metrics.test.mjs'],ROOT/'dashboard')
run('typescript_full_project',[NODE,'node_modules/typescript/bin/tsc','--noEmit','--pretty','false'],ROOT/'dashboard')
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,
 'note':'Full-project TypeScript diagnostics are recorded separately from runtime builds and regression tests; do not report complete typecheck success while diagnostics remain.'}
(ROOT/'ai-local-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
assert checks['backend']['exit_code']==0 and checks['chart_regression']['exit_code']==0
