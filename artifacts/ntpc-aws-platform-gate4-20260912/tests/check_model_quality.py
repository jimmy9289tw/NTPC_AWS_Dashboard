"""Only a fixed public-statistics test; never logs real user prompts or sessions."""
import sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_ai import payload,load
from ai_evidence import build_evidence
import ai_chat
p=payload(question='114年淡水區30–35歲人口與前一年相比如何變化？')
e,n=build_evidence(p,load)
def capture(**request):
    r=ai_chat.SESSION.client('bedrock-runtime',config=ai_chat.CONFIG).converse(**request)
    print('SYNTHETIC_TEST_RAW',json.dumps(r['output'],ensure_ascii=False))
    return r
ai_chat.take_model_lease()
try: print('VERIFIED',json.dumps(ai_chat.model_answer(p,e,n,capture),ensure_ascii=False))
finally: ai_chat.release_model_lease()
