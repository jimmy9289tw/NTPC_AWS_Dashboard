from pathlib import Path
import json
from etl.common import LocalStore
from etl.monthly import run
if __name__=='__main__':
    result=run(LocalStore(Path(__file__).resolve().parent/'runtime-local'))
    print(json.dumps({k:result[k] for k in ['status','rows','latest_available','checked_periods','run_id']},ensure_ascii=False))
