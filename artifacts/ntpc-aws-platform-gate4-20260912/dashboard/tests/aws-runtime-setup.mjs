import fs from 'node:fs';
const snapshot=JSON.parse(fs.readFileSync(new URL('../../live-bootstrap.json',import.meta.url),'utf8'));
globalThis.window={__NTPC_DATA__:snapshot};
