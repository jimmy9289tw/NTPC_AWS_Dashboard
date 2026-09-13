"""官方教育×婚姻原始列→15–39歲原生五歲帶交叉表；未拆齡。"""
from pathlib import Path
from collections import defaultdict
import csv,json,re,hashlib
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'
EDU={'博畢':'研究所','碩畢':'研究所','大畢':'大學','專畢':'專科','高中畢':'高中職','國中畢':'國中及以下','國小畢以下':'國中及以下'}
MAR=['未婚','有偶_不同性別','有偶_相同性別','離婚_不同性別','離婚_相同性別','喪偶_不同性別','喪偶_相同性別']
HEADERS=['民國年度','地區代碼','地區','年齡下限','年齡上限','性別','教育程度彙整','婚姻狀態彙整','人口數']
def main():
    output=WORK/'additional-inputs/新北市及29區_年齡性別教育婚姻交叉人口_110至114年.csv';output.parent.mkdir(parents=True,exist_ok=True)
    allrows=[];diagnostics=[]
    for year in range(110,115):
        path=WORK/f'data/raw/MOI-EDU-SINGLEAGE/{year}/opendata{year}Y051.csv';sums=defaultdict(int);seen={};names={};used=0
        with path.open(encoding='utf-8-sig',newline='') as f:
            reader=csv.DictReader(f)
            if reader.fieldnames!=['statistic_yyy','district_code','site_id','village','sex','age','marital_status','edu','population']:raise ValueError('官方交叉表欄位改變')
            for row in reader:
                row['statistic_yyy']=row['statistic_yyy'].lstrip('\ufeff')
                if row['statistic_yyy']=='統計年':continue
                if row['statistic_yyy']!=str(year):raise ValueError('交叉表年度不符')
                if not row['site_id'].startswith('新北市'):raise ValueError('新北市原始列包含其他地區')
                match=re.fullmatch(r'(\d+)~(\d+)歲',row['age'])
                if not match or int(match[1]) not in [15,20,25,30,35]:continue
                lo,hi=map(int,match.groups());code=row['district_code'];sex=row['sex'];edu=row['edu'];mar=row['marital_status'];pop=row['population']
                if len(code)!=11 or not code.startswith('65') or sex not in ['男','女'] or edu not in EDU or mar not in MAR or not re.fullmatch(r'\d+',pop):raise ValueError('原始交叉資料缺漏或分類改變')
                cell=(((lo-15)//5*2+['男','女'].index(sex))*7+list(EDU).index(edu))*7+MAR.index(mar)
                bits=seen.setdefault(code,bytearray(490))
                if bits[cell]:raise ValueError('原始交叉資料有重複')
                bits[cell]=1;used+=1;geo=code[:8];names[geo]=row['site_id']
                category='未婚' if mar=='未婚' else '有偶' if mar.startswith('有偶') else '離婚或終止結婚' if mar.startswith('離婚') else '喪偶'
                for g in [geo,'65000000']:sums[(g,lo,hi,sex,EDU[edu],category)]+=int(pop)
        if len(names)!=29 or not all(all(bits) for bits in seen.values()):raise ValueError('29區或原生五歲帶交叉格不完整')
        names['65000000']='新北市'
        for (geo,lo,hi,sex,edu,mar),count in sorted(sums.items()):allrows.append(dict(zip(HEADERS,[year,geo,names[geo],lo,hi,sex,edu,mar,count])))
        diagnostics.append({'year':year,'villages':len(seen),'native_rows_checked':used,'joint_cells':len(sums),'missing_cells':0,'duplicates':0})
    with output.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=HEADERS);w.writeheader();w.writerows(allrows)
    (ROOT/'joint-input-validation.json').write_text(json.dumps({'status':'PASS','rows':len(allrows),'years':diagnostics},indent=2),encoding='utf-8');print(len(allrows))
if __name__=='__main__':main()
