import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const required=['README.md','.kiro/steering/competition-v1.md','.kiro/specs/competition-v1/requirements.md','.kiro/specs/competition-v1/design.md','.kiro/specs/competition-v1/tasks.md','.kiro/hooks/competition-check.json','dashboard/package-lock.json','data/published/competition-catalog.json'];
for(const p of required) if(!fs.existsSync(path.join(root,p))) throw new Error(`Missing ${p}`);
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/published/competition-catalog.json'),'utf8'));
for(const d of catalog.canonicalDatasets){const b=fs.readFileSync(path.join(root,'data/published',d.path));if(crypto.createHash('sha256').update(b).digest('hex')!==d.sha256) throw new Error(`Hash mismatch: ${d.id}`);}
console.log(`Handoff contract OK: ${required.length} required files, ${catalog.canonicalDatasets.length} dataset hashes`);
