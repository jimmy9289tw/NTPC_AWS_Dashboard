"""發布閘門：獨立檢查值、分母、模型收斂及所有行政區排名。"""
from pathlib import Path
from collections import Counter,defaultdict
import csv,json,math
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'
def rows(p):
    with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def check(condition,message):
    if not condition:raise ValueError(message)
def main():
    count=0;tables=[];pub=WORK/'result/09_發布資料包'
    for prefix,expected in [('01',39150),('02',180),('03',32),('06',204)]:
        p=next(pub.glob(prefix+'_*.csv'));data=rows(p);keys=set();composition=defaultdict(float)
        check(len(data)==expected,p.name+' 筆數不符已支援年度契約')
        for r in data:
            check(len(r)==42,'長表欄位不完整');check(r['record_id'] not in keys,'長表重複主鍵');keys.add(r['record_id'])
            if r['value']!='':check(math.isfinite(float(r['value'])),'非有限值')
            if r['value'] and r['numerator'] and r['denominator'] and float(r['denominator'])>0 and r['unit']=='%':
                check(abs(float(r['value'])-float(r['numerator'])/float(r['denominator'])*100)<0.002,'分子／分母與比率不符');count+=1
            if r['metric_code'] in ['EDUCATION_SHARE_PCT','MARITAL_STATUS_SHARE_PCT'] and r['value']:
                composition[(r['roc_year'],r['geography_code'],r['age_band'],r['sex_code'],r['metric_code'])]+=float(r['value'])
            if prefix=='02':check(r['geography_level']=='CITY' and r['universe_code']=='CIVILIAN_LABOR_MARKET','勞動母體或地理層級錯誤')
            if prefix=='03':check(int(r['roc_year'])<=113 and r['universe_code']=='EMPLOYEE_WAGE','薪資母體或期間錯誤')
        for value in composition.values():check(abs(value-100)<0.002,'完整組成比未加總100%')
        tables.append({'name':p.name,'rows':len(data),'compositions':len(composition)})
    diag=json.loads((WORK/'result/08_人工查核與異常處理/machine_qa/data_build_diagnostics.json').read_text(encoding='utf-8'))
    for y,d in diag['registered_population']['years'].items():
        for dim in ['education','marital']:
            check(d[dim+'_pclm_converged'],y+' PCLM 未收斂')
            check(d[dim+'_max_ipf_row_error']<1e-5 and d[dim+'_max_ipf_col_error']<1e-5,y+' IPF 不符合官方母數')
    model_checks=Counter()
    for p in (WORK/'deliverables/NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825').rglob('*validation_checks.csv'):
        for r in rows(p):check(r['status']!='FAIL','勞動模型查核失敗');model_checks[r['status']]+=1
    rankdata=rows(WORK/'dashboard/data/policy-ranking/01_新北市29行政區青年指標排名.csv');groups=defaultdict(list)
    for r in rankdata:groups[(r['民國年度'],r['年齡層'],r['性別'])].append(r)
    pairs=[('戶籍人口數','戶籍人口數排名'),('戶籍人口密度_人每平方公里','戶籍人口密度排名'),('戶籍人口年度變化率_百分比','戶籍人口年度變化率排名'),('青年據點數','青年據點數排名')]
    pairs += [(s+'比例_百分比',s+'比例排名') for s in ['國中及以下','高中職','專科','大學','研究所','未婚','有偶','離婚或終止結婚','喪偶']]
    ranking_checks=0
    for cohort in groups.values():
        check(len(cohort)==29 and len({r['新北市行政區'] for r in cohort})==29,'排名缺行政區')
        for value,rank in pairs:
            check(all(r[value]!='' and r[rank]!='' for r in cohort),'排名輸入或結果空白')
            values=[float(r[value]) for r in cohort]
            for r,v in zip(cohort,values):
                check(int(r[rank])==1+sum(w>v for w in values),'排名未同步重算');ranking_checks+=1
    report={'status':'PASS','tables':tables,'ratio_checks':count,'ranking_checks':ranking_checks,'labor_checks':dict(model_checks),'scope':'110–114年；薪資110–113年。保留模型敏感度警示。'}
    (ROOT/'runtime-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
