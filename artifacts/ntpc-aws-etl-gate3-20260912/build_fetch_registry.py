from pathlib import Path
import ast,hashlib,json,re
ROOT=Path(__file__).resolve().parent;WORK=ROOT/'work'
def constants(path,names):
    tree=ast.parse(path.read_text(encoding='utf-8'));out={}
    for node in tree.body:
        if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name) and node.targets[0].id in names:out[node.targets[0].id]=ast.literal_eval(node.value)
    return out
def main():
    d=json.loads((ROOT/'discovery.json').read_text(encoding='utf-8'));files=[]
    def add(url,target,group,year=None,transform=None):
        files.append(dict(url=url,target=target,source_name=url.rsplit('/',1)[-1],group=group,year=year,transform=transform))
    for year in range(110,115):
        for dataset,folder,suffix in [('117988','MOI-EDU-SINGLEAGE','051'),('117986','MOI-MARITAL5Y','031')]:
            match=[x['url'] for x in d[dataset]['links'] if x['url'].endswith(f'opendata{year}Y{suffix}.zip')]
            if len(match)!=1:raise ValueError('官方教育婚姻下載連結不完整')
            add(match[0],f'data/raw/{folder}/{year}/opendata{year}Y{suffix}.csv','population',year,'ntpc_csv')
        for t in [27,28,32,36,37]:
            match=[x['url'] for x in d[f'labor-{year}']['links'] if re.search(fr'/table{t}\.xlsx?$',x['url'])]
            if len(match)!=1:raise ValueError('官方勞動下載連結不完整')
            add(match[0],f'deliverables/NTPC_Labor_18-35_Sprague_PCLM_Pilot_V1.1_20260825/raw/annual/{year}/table{t}.xlsx','labor',year,'xls_to_xlsx' if match[0].endswith('.xls') else None)
    for t,name in [(41,'DGBAS-NTPC-UR-AGE-T41-11412.xlsx'),(42,'DGBAS-NTPC-LABOR-AGE-T42-114H2.xlsx')]:
        add(f'https://ws.dgbas.gov.tw/001/Upload/463/relfile/11040/235759/table{t}.xlsx','additional-inputs/'+name,'labor',114)
    c=constants(WORK/'dashboard/scripts/build_youth_resident_employment_industry_data.py',['ANNUAL_SOURCES','HALF_YEAR_SOURCES'])
    for year,(_,url) in c['ANNUAL_SOURCES'].items():add(url,f'dashboard/work/official-source-check/DGBAS_{year}_Annual_Table33_Industry{Path(url).suffix}','industry',year)
    for year,halves in c['HALF_YEAR_SOURCES'].items():
        for half,(_,url) in halves.items():add(url,f'dashboard/work/official-source-check/DGBAS_{year}_{half}_NTPC_Industry_Age{Path(url).suffix}','industry',year)
    for number,targets in [(6,['data/raw/WAGE-AUX/20260826/STAT-WAGE-LOC-TABLE6-current.xlsx','dashboard/data/raw/DGBAS-WAGE-INDUSTRY-AGE/20260907/DGBAS-WAGE-TABLE6-COUNTY-AGE.xlsx']),(2,['dashboard/data/raw/DGBAS-WAGE-INDUSTRY-AGE/20260907/DGBAS-WAGE-TABLE2-INDUSTRY-AGE.xlsx'])]:
        urls=[x['url'] for x in d['wage']['links'] if f'/表{number}' in x['url'] and x['url'].endswith('.xlsx')]
        if len(urls)!=1:raise ValueError('官方薪資下載連結不完整')
        for target in targets:add(urls[0],target,'wage',113)
    add('https://data.ntpc.gov.tw/api/datasets/13f881c7-53c4-4f8c-b693-816584562666/csv','data/raw/NTPC-LAND-AREA/20260831/NTPC-DISTRICT-LAND-AREA.csv','area')
    result={'version':'G3-1','supported_years':[110,111,112,113,114],'wage_available_years':[110,111,112,113],'files':files,'note':'CSV 為官方原始列；ZIP 只暫存於擷取工作目錄，不上傳 S3。未知新年度須先通過欄位契約。'}
    (ROOT/'fetch-registry.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(len(files))
if __name__=='__main__':main()
