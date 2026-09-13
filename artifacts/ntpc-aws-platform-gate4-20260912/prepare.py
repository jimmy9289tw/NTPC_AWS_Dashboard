from pathlib import Path
import shutil, json

ROOT = Path(__file__).resolve().parent
SOURCE = Path('D:/github/artifacts/NTPC_Youth_System_V1_20260912/09_網站與完整原始碼/完整原始碼/dashboard')
TARGET = ROOT / 'dashboard'
if not TARGET.exists():
    shutil.copytree(SOURCE, TARGET, ignore=shutil.ignore_patterns('node_modules', '.env', '.env.local', '.env.production', '.wrangler', '.git', 'dist', '.next'))
rules = Path('D:/github/artifacts/NTPC_Youth_System_V1_20260912/08_ROA與四象限/ROA正式套件/02_分級規則/四象限分級與建議.json')
shutil.copy2(rules, ROOT / 'roa-rules.json')
print(json.dumps({'copy': str(TARGET), 'original_preserved': SOURCE.exists(), 'files': len(list(TARGET.rglob('*')))}, ensure_ascii=False))
