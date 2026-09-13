"""Read-only capability checks. Never print signed headers or credentials."""
import json
import urllib.request
import urllib.error
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.config import Config

session = boto3.Session(region_name='us-west-2')
config = Config(retries={'max_attempts': 0})
assert session.client('sts', config=config).get_caller_identity()['Account'] == '000000000000'
b = session.client('bedrock', config=config)
for model in ['openai.gpt-5.6-luna', 'amazon.nova-lite-v1:0']:
    try:
        r = b.get_foundation_model_availability(modelId=model)
        print(json.dumps({'model': model, 'availability': {k:v for k,v in r.items() if k!='ResponseMetadata'}}))
    except Exception as e:
        print(json.dumps({'model':model,'error':getattr(e,'response',{}).get('Error',{}).get('Code',type(e).__name__)}))
url = 'https://bedrock-mantle.us-west-2.api.aws/v1/models'
req = AWSRequest(method='GET', url=url)
SigV4Auth(session.get_credentials().get_frozen_credentials(), 'bedrock-mantle', 'us-west-2').add_auth(req)
try:
    with urllib.request.urlopen(urllib.request.Request(url, headers=dict(req.headers)), timeout=20) as res:
        data=json.load(res)
        print(json.dumps({'mantle_status':res.status,'models':[m['id'] for m in data.get('data',[])]}))
except urllib.error.HTTPError as e:
    print(json.dumps({'mantle_status':e.code,'message':e.read().decode()[:1300]}))
