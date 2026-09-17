import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
const { chromium } = await import(process.env.POM_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve('.');
const evidence = path.resolve('pom512-evidence');
await fs.mkdir(evidence, {recursive:true});
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
    const data = await fs.readFile(file);
    const type = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp'}[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, {'Content-Type':type,'Cache-Control':'no-store'}).end(data);
  } catch {res.writeHead(404).end('Not found');}
});
await new Promise(resolve => server.listen(8765, '127.0.0.1', resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const consoleErrors = [], requestErrors = [];
page.on('pageerror', error => consoleErrors.push(error.message));
page.on('console', message => {if(message.type() === 'error') consoleErrors.push(message.text());});
page.on('requestfailed', request => requestErrors.push({url:request.url(),error:request.failure()?.errorText}));
const results = {schema:1, sourceCommit:process.env.GITHUB_SHA || null, scope:'Isolated hosted lab, Three.js 0.180.0, real production PomDecalMaterial', tests:[], consoleErrors, requestErrors, passed:false};
try {
  await page.goto('http://127.0.0.1:8765/shipmodule-pom-lab/hatch512.html', {waitUntil:'networkidle',timeout:45000});
  await page.waitForFunction(() => window.__POM_LAB__?.ready || window.__POM_LAB__?.errors.length, {timeout:45000});
  const info = await page.evaluate(() => ({ready:window.__POM_LAB__.ready, errors:window.__POM_LAB__.errors, size:window.__POM_LAB__.size, maps:window.__POM_LAB__.maps, key:window.__POM_LAB__.programKey, webgl:window.__POM_LAB__.webglVersion, heightSource:window.__POM_LAB__.heightSource}));
  assert.equal(info.ready, true, JSON.stringify(info.errors));
  assert.equal(info.size, 512);
  assert.equal(Object.keys(info.maps).length, 5);
  assert.ok(Object.values(info.maps).every(map => map.verified));
  assert.match(info.key, /pom/i);
  results.tests.push({name:'512 texture integrity and production POM compile',passed:true,...info});
  for (const pose of ['front','oblique','grazing']) {
    await page.evaluate(kind => window.__POM_LAB__.cameraPreset(kind), pose);
    await page.waitForTimeout(600);
    const sample = await page.evaluate(() => window.__POM_LAB__.snapshot());
    assert.equal(sample.glError, 0);
    if(pose !== 'grazing') assert.ok(sample.variance > 25 && sample.max - sample.min > 30, `${pose}: blank render`);
    await page.screenshot({path:path.join(evidence,`${pose}.png`)});
    results.tests.push({name:`Render ${pose}`,passed:true,...sample});
  }
  await page.evaluate(() => window.__POM_LAB__.cameraPreset('oblique'));
  await page.evaluate(() => window.__POM_LAB__.setHeight(0));
  await page.waitForTimeout(400);
  const zero = await page.evaluate(() => window.__POM_LAB__.snapshot());
  await page.evaluate(() => window.__POM_LAB__.setHeight(.06));
  await page.waitForTimeout(400);
  const deep = await page.evaluate(() => window.__POM_LAB__.snapshot());
  assert.ok(Math.abs(zero.variance - deep.variance) > .01, 'POM height did not change the rendered surface');
  results.tests.push({name:'Height 0 -> 0.06 changes rendered pixels',passed:true,zero,deep});
  await page.screenshot({path:path.join(evidence,'oblique-height-006.png')});
  await page.locator('#cutout').check();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.__POM_LAB__.snapshot().glError),0);
  results.tests.push({name:'External alpha cutout',passed:true});
  await page.locator('#reset').click();
  await page.waitForTimeout(400);
  await page.screenshot({path:path.join(evidence,'default-512.png')});
  assert.deepEqual(await page.evaluate(() => window.__POM_LAB__.errors),[]);
  assert.deepEqual(consoleErrors,[]);
  assert.deepEqual(requestErrors,[]);
  results.passed = true;
} catch(error) {
  results.error = error.stack || String(error);
  results.status = await page.locator('#status').textContent().catch(()=>null);
  await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});
} finally {
  await fs.writeFile(path.join(evidence,'results.json'),JSON.stringify(results,null,2));
  if(results.passed) await fs.writeFile('shipmodule-pom-lab/validation512.json',JSON.stringify(results,null,2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
if(!results.passed) throw new Error(results.error || 'Browser validation failed');
console.log(JSON.stringify(results,null,2));
