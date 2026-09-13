"""固定基準完整重算。所有輸出在隔離 work；不改正式快照。"""
import argparse,json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
WORK=ROOT/'work'
LABOR=WORK/'deliverables/NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825'
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--stage',required=True,choices=['labor','core','external','dashboard','industry','joint','wage-industry','rankings']);args=parser.parse_args()
    py=sys.executable;script=WORK/'scripts';dash=WORK/'dashboard/scripts'
    commands={
        'labor':[[py,str(script/'analyze_labor_age_graduation_v24.py'),'--table-41',str(WORK/'additional-inputs/DGBAS-NTPC-UR-AGE-T41-11412.xlsx'),'--table-42',str(WORK/'additional-inputs/DGBAS-NTPC-LABOR-AGE-T42-114H2.xlsx'),'--output-dir',str(LABOR/'half_year_114H2')],
                 [py,str(script/'analyze_annual_labor_age_graduation_v24.py'),'--raw-root',str(LABOR/'raw/annual'),'--h2-reconciliation',str(LABOR/'half_year_114H2/source_rounding_reconciliation.csv'),'--output-dir',str(LABOR/'annual_110_114')]],
        'core':[[py,str(script/'build_g5_v3_data.py'),'--package',str(WORK/'result'),'--years','110,111,112,113,114']],
        'external':[[py,str(script/'build_external_policy_data.py'),'--package',str(WORK/'result')]],
        'dashboard':[[py,str(script/'export_g5_dashboard_json.py'),'--package',str(WORK/'result')]],
        'industry':[[py,str(dash/'build_youth_resident_employment_industry_data.py')]],
        'joint':[[py,str(dash/'build-joint-education-marriage.py'),'--source',str(WORK/'additional-inputs/新北市及29區_年齡性別教育婚姻交叉人口_110至114年.csv')]],
        'wage-industry':[[py,str(dash/'build-youth-industry-wage.py')]],
        'rankings':[[os.environ.get('NTPC_NODE','C:/Users/jimmy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'),str(dash/'build-policy-ranking-csv.mjs')]],
    }
    logdir=ROOT/'logs';logdir.mkdir(exist_ok=True)
    start=time.monotonic();results=[]
    for i,command in enumerate(commands[args.stage]):
        with (logdir/f'{args.stage}-{i}.log').open('w',encoding='utf-8') as out:
            result=subprocess.run(command,cwd=WORK,env={**os.environ,'PYTHONUTF8':'1','OPENBLAS_NUM_THREADS':'1'},stdout=out,stderr=subprocess.STDOUT)
        results.append({'script':Path(command[1]).name,'exit_code':result.returncode})
        if result.returncode:
            print((logdir/f'{args.stage}-{i}.log').read_text(encoding='utf-8')[-6000:],flush=True)
            break
    summary={'stage':args.stage,'seconds':round(time.monotonic()-start,2),'steps':results,'status':'PASS' if all(r['exit_code']==0 for r in results) else 'FAIL'}
    (ROOT/f'rebuild-{args.stage}.json').write_text(json.dumps(summary,indent=2),encoding='utf-8');print(json.dumps(summary))
    return 0 if summary['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
