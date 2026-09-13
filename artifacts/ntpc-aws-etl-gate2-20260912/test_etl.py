"""只在 TemporaryDirectory 使用合成數值測試；不發布測試資料。"""
import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from etl import monthly
from etl.common import LocalStore,DataError,Conflict,encoded,digest,publish,safe_key,OfficialRedirect
ROOT=Path(__file__).resolve().parent

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.store=LocalStore(self.tmp.name)
        self.contract=json.loads((ROOT/'runtime-local/config/monthly-contract.json').read_bytes())
        self.geos=self.contract['geographies'];self.latest='11412';self.fail=False
        initial=monthly.aggregate(self.rows('11412'),'11412',self.geos)[0]
        body=encoded({'meta':{},'records':initial})
        self.contract.update(baseline_sha256=digest(body),annual_december_values={})
        self.store.put('baseline/monthly-population.json',body,create=True)
        self.store.put('config/monthly-contract.json',encoded(self.contract),create=True)
    def rows(self,period):
        rows=[]
        for name,code in self.geos.items():
            if name=='新北市':continue
            row={'site_id':name,'district_code':code+'001','statistic_yyymm':period}
            for age in range(18,36):row.update({f'people_age_{age:03d}_m':'10',f'people_age_{age:03d}_f':'11'})
            rows.append(row)
        return rows
    def page(self,period):
        return {'responseCode':'OD-0101-S','totalDataSize':'29','totalPage':'1','page':'1','pageDataSize':'29','responseData':self.rows(period)}
    def fetch(self,url):
        if self.fail:raise RuntimeError('測試擷取失敗')
        if url==monthly.CATALOG:body=f'<p>{self.latest}-村里戶數</p>'.encode()
        else:body=encoded(self.page(url.split('/')[-1].split('?')[0]))
        return body,{'url':url,'sha256':digest(body),'retrieved_at':'2026-09-12T00:00:00+00:00','bytes':len(body),'http_status':200}
    def test_periods(self):self.assertEqual(monthly.period_range('11412','11502'),['11412','11501','11502'])
    def test_invalid_period(self):
        with self.assertRaises(DataError):monthly.period_range('11413','11502')
    def test_missing_value(self):
        rows=self.rows('11412');del rows[0]['people_age_035_f']
        with self.assertRaises(DataError):monthly.aggregate(rows,'11412',self.geos)
    def test_missing_district(self):
        with self.assertRaises(DataError):monthly.aggregate(self.rows('11412')[:-1],'11412',self.geos)
    def test_missing_page(self):
        p=self.page('11412');p['totalPage']='2'
        with self.assertRaises(DataError):monthly.parse_pages([p],'11412')
    def test_wrong_source_period(self):
        with self.assertRaises(DataError):monthly.parse_pages([self.page('11412')],'11501')
    def test_chinese_schema(self):
        p=self.page('11412')
        for row in p['responseData']:
            for old,new in [('statistic_yyymm','統計年月'),('district_code','區域別代碼'),('site_id','區域別')]:row[new]=row.pop(old)
            for age in range(18,36):
                for sex,label in [('m','男'),('f','女')]:row[f'{age}歲-{label}']=row.pop(f'people_age_{age:03d}_{sex}')
        result=monthly.aggregate(monthly.parse_pages([p],'11412'),'11412',self.geos)[0]
        self.assertEqual(len(result),360)
    def test_schema_conflict(self):
        with self.assertRaises(DataError):monthly.normalize({'統計年月':'11412','statistic_yyymm':'11501'})
    def test_duplicate_village(self):
        p=self.page('11412');p['responseData'][1]=p['responseData'][0]
        with self.assertRaises(DataError):monthly.parse_pages([p],'11412')
    def test_negative_not_zero(self):
        for v in [-1,None,'',True,'1.2']:
            with self.assertRaises(DataError):monthly.integer(v)
    def test_balances(self):
        rows=monthly.aggregate(self.rows('11412'),'11412',self.geos)[0];rows[0]['population']+=1
        with self.assertRaises(DataError):monthly.validate(rows,self.geos,['11412'])
    def test_paths(self):
        for key in ['../x','x.zip','/x','C:/x','a\\x']:
            with self.assertRaises(DataError):safe_key(key)
    def test_redirect(self):
        with self.assertRaises(DataError):OfficialRedirect().redirect_request(None,None,302,'',{},'http://example.com/x')
    def test_publish_and_no_change(self):
        first=monthly.run(self.store,self.fetch);pointer=self.store.get('current/monthly.json')
        second=monthly.run(self.store,self.fetch)
        self.assertEqual(first['status'],'PUBLISHED');self.assertEqual(second['status'],'NO_CHANGE')
        self.assertEqual(pointer,self.store.get('current/monthly.json'))
    def test_new_period(self):
        monthly.run(self.store,self.fetch);self.latest='11501'
        result=monthly.run(self.store,self.fetch)
        self.assertEqual(result['rows'],720);self.assertEqual(result['status'],'PUBLISHED')
    def test_failure_preserves_pointer(self):
        monthly.run(self.store,self.fetch);pointer=self.store.get('current/monthly.json');self.fail=True
        with self.assertRaises(RuntimeError):monthly.run(self.store,self.fetch)
        self.assertEqual(pointer,self.store.get('current/monthly.json'))
    def test_stale_publisher(self):
        publish(self.store,'example',{'x.json':b'1'},{},None);pointer=self.store.get('current/example.json')
        with self.assertRaises(Conflict):publish(self.store,'example',{'x.json':b'2'},{},None)
        self.assertEqual(pointer,self.store.get('current/example.json'))
    def test_failed_upload_not_committed(self):
        original=self.store.put
        def fail(key,*args,**kwargs):
            if key.endswith('/b.json'):raise OSError('測試發布失敗')
            return original(key,*args,**kwargs)
        with patch.object(self.store,'put',fail):
            with self.assertRaises(OSError):publish(self.store,'test',{'a.json':b'1','b.json':b'2'},{},None)
        self.assertIsNone(self.store.get('current/test.json')[0])
    def test_year_end_guard(self):
        self.contract['annual_december_values']={'11412|新北市|18-35|合計':1}
        path=self.store.path('config/monthly-contract.json');path.write_bytes(encoded(self.contract))
        with self.assertRaises(DataError):monthly.run(self.store,self.fetch)
        self.assertIsNone(self.store.get('current/monthly.json')[0])

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    (ROOT/'test-results.json').write_bytes(encoded({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'passed':result.wasSuccessful(),'scope':'合成測試資料，不上傳或用於正式分析'}))
    raise SystemExit(not result.wasSuccessful())
