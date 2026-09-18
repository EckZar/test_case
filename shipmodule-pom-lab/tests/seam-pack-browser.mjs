import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.POM_PLAYWRIGHT_PATH || 'playwright');
const root = process.cwd();
const output = path.join(root, 'seam-pack-evidence');
await mkdir(output, { recursive: true });
const mime = { '.js':'application/javascript', '.html':'text/html', '.json':'application/json', '.png':'image/png', '.webp':'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const localUrl = `http://127.0.0.1:${server.address().port}/shipmodule-pom-lab/seams.html`;
const browser = await chromium.launch({ headless:true, args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const report = { commit: process.env.GITHUB_SHA || 'local', tests:[], errors:[], passed:false };
const pass = (name, data={}) => report.tests.push({ name, passed:true, ...data });

async function waitReady(page) {
  await page.waitForFunction(() => window.__POM_SEAM_LAB__?.ready || window.__POM_SEAM_LAB__?.errors.length, { timeout:120000 });
  const state = await page.evaluate(() => ({
    ready: __POM_SEAM_LAB__.ready, errors: __POM_SEAM_LAB__.errors,
    assetId: __POM_SEAM_LAB__.assetId, layout: __POM_SEAM_LAB__.layout,
    loadedAssets: __POM_SEAM_LAB__.loadedAssets, resolution: __POM_SEAM_LAB__.resolution,
    programKey: __POM_SEAM_LAB__.programKey, parameters: __POM_SEAM_LAB__.parameters,
    snapshot: __POM_SEAM_LAB__.snapshot(),
  }));
  assert.equal(state.ready, true, JSON.stringify(state));
  assert.deepEqual(state.errors, []);
  assert.match(state.programKey, /v4/);
  assert.equal(state.snapshot.glError, 0);
  assert.ok(state.snapshot.max - state.snapshot.min > 20);
  assert.ok(state.snapshot.variance > 12);
  return state;
}

async function run(page, url, prefix) {
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type()==='error' && !message.text().includes('favicon')) errors.push(message.text()); });
  await page.goto(url, { waitUntil:'networkidle', timeout:180000 });
  const open = page.locator('a').filter({ hasText:/open the page|continue/i });
  if (await open.count()) await open.first().click();
  let state=await waitReady(page);
  assert.equal(state.assetId,'straight_frame_a');
  assert.equal(state.layout,'join');
  assert.deepEqual(state.loadedAssets,['straight_frame_a']);
  pass(`${prefix}: straight chain ready`, state);

  for (const kind of ['front','oblique','grazing']) {
    await page.evaluate(value => __POM_SEAM_LAB__.cameraPreset(value), kind);
    await page.waitForTimeout(250);
    const snap=await page.evaluate(() => __POM_SEAM_LAB__.snapshot());
    assert.equal(snap.glError,0); pass(`${prefix}: ${kind}`, snap);
  }

  await page.evaluate(async () => { await __POM_SEAM_LAB__.setAsset('cross_hub_a'); await __POM_SEAM_LAB__.setLayout('join'); });
  state=await waitReady(page);
  assert.ok(state.loadedAssets.includes('cross_hub_a'));
  assert.ok(state.loadedAssets.includes('straight_frame_a'));
  pass(`${prefix}: junction plus straight ports`, state);

  const before=await page.evaluate(() => __POM_SEAM_LAB__.snapshot());
  await page.locator('#sinkScale').evaluate(el => { el.value='1.8'; el.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.waitForFunction(() => Math.abs(__POM_SEAM_LAB__.parameters.sinkScale-1.8)<1e-6);
  assert.equal(await page.evaluate(() => __POM_SEAM_LAB__.uniforms().pomSinkScale),1.8);
  const after=await page.evaluate(() => __POM_SEAM_LAB__.snapshot());
  assert.notEqual(before.hash, after.hash);
  pass(`${prefix}: sink changes uniform and pixels`, { before:before.hash, after:after.hash });

  await page.evaluate(async () => { await __POM_SEAM_LAB__.setLayout('network'); });
  state=await waitReady(page);
  assert.equal(state.layout,'network');
  assert.equal(state.loadedAssets.length,2);
  pass(`${prefix}: network assembly`, state);
  assert.deepEqual(errors,[]);
  await page.screenshot({ path:path.join(output,`${prefix}-network.png`), fullPage:true });
}

try {
  const local=await browser.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:1 });
  await run(local,localUrl,'local'); await local.close();
  if (process.env.GITHUB_SHA) {
    const url=`https://rawcdn.githack.com/EckZar/test_case/${process.env.GITHUB_SHA}/shipmodule-pom-lab/seams.html`;
    let finalError;
    for (let attempt=1; attempt<=8; attempt++) {
      const hosted=await browser.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:1 });
      try { await run(hosted,url,'hosted'); report.hostedUrl=url; finalError=null; await hosted.close(); break; }
      catch (error) { finalError=error; await hosted.screenshot({path:path.join(output,`hosted-${attempt}.png`),fullPage:true}).catch(()=>{}); await hosted.close(); if(attempt<8) await new Promise(r=>setTimeout(r,20000)); }
    }
    if (finalError) throw finalError;
  }
  report.passed=true;
} catch (error) { report.failure=error.stack; process.exitCode=1; }
finally {
  await writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close(); server.close();
}
