"""AWS Lambda：只執行已通過驗證的月人口 ETL，不重算未核對的模型。"""
import os,json
from .common import S3Store
from .monthly import run
def handler(event,context):
    result=run(S3Store(os.environ['DATA_BUCKET'],os.environ['ETL_PREFIX'],os.environ['DATA_ACCOUNT']))
    summary={k:result[k] for k in ['status','rows','latest_available','checked_periods','run_id']}
    print(json.dumps(summary,ensure_ascii=False))
    return summary
