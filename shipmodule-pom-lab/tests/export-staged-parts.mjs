import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const manifest = JSON.parse(await fs.readFile('shipmodule-pom-lab/tests/staged-parts.json','utf8'));
await fs.mkdir('pom-validation/staged-parts',{recursive:true});
for (const item of manifest) {
  const response = await fetch(`https://api.github.com/repos/EckZar/test_case/git/blobs/${item.sha}`, {headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}});
  if (!response.ok) throw new Error(`Git blob ${item.sha}: HTTP ${response.status}`);
  const result = await response.json();
  if (result.encoding !== 'base64') throw new Error('Unexpected blob transport encoding');
  const bytes=Buffer.from(result.content,'base64');
  const actual=crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(actual!==item.sha) throw new Error('Git blob SHA mismatch');
  await fs.writeFile(`pom-validation/staged-parts/${item.name}`,bytes);
}
