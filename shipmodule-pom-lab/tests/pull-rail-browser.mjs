import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.POM_PLAYWRIGHT_PATH || 'playwright');
const root = process.cwd();
const output = path.join(root, 'pull-rail-evidence');
await mkdir(output, { recursive: true });
const mime = { '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
    response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const localUrl = `http://127.0.0.1:${server.address().port}/shipmodule-pom-lab/pull-rail.html`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const report = { commit: process.env.GITHUB_SHA || 'local', tests: [], errors: [], passed: false };
const test = (name, data = {}) => report.tests.push({ name, passed: true, ...data });

async function inspect(page) {
  await page.waitForFunction(() => window.__POM_ASSET_LAB__?.ready || window.__POM_ASSET_LAB__?.errors.length, { timeout: 90000 });
  const state = await page.evaluate(() => ({
    ready: __POM_ASSET_LAB__.ready,
    errors: __POM_ASSET_LAB__.errors,
    assetId: __POM_ASSET_LAB__.assetId,
    resolution: __POM_ASSET_LAB__.resolution,
    maps: __POM_ASSET_LAB__.maps,
    programKey: __POM_ASSET_LAB__.programKey,
    parameters: __POM_ASSET_LAB__.parameters,
    snapshot: __POM_ASSET_LAB__.snapshot(),
  }));
  assert.equal(state.ready, true, JSON.stringify(state));
  assert.deepEqual(state.errors, []);
  assert.equal(state.assetId, 'pull-rail-panel-01');
  assert.deepEqual(state.resolution, [256, 864]);
  assert.equal(Object.keys(state.maps).length, 2);
  assert.match(state.programKey, /v4/);
  assert.equal(state.snapshot.glError, 0);
  assert.ok(state.snapshot.max - state.snapshot.min > 25);
  assert.ok(state.snapshot.variance > 20);
  return state;
}

async function runPage(page, url, prefix) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  const initial = await inspect(page);
  test(`${prefix}: fixture integrity and shader compile`, initial);

  for (const kind of ['front', 'oblique', 'grazing']) {
    await page.evaluate(value => __POM_ASSET_LAB__.cameraPreset(value), kind);
    await page.waitForTimeout(350);
    const snapshot = await page.evaluate(() => __POM_ASSET_LAB__.snapshot());
    assert.equal(snapshot.glError, 0);
    test(`${prefix}: rendered ${kind}`, snapshot);
  }

  await page.evaluate(() => __POM_ASSET_LAB__.cameraPreset('oblique'));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => __POM_ASSET_LAB__.snapshot());
  await page.locator('#sinkScale').evaluate(element => {
    element.value = '1.8';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => Math.abs(__POM_ASSET_LAB__.parameters.sinkScale - 1.8) < 1e-6);
  assert.equal(await page.evaluate(() => __POM_ASSET_LAB__.uniforms().pomSinkScale), 1.8);
  const after = await page.evaluate(() => __POM_ASSET_LAB__.snapshot());
  assert.notEqual(before.hash, after.hash, 'Sink slider does not affect pixels');
  test(`${prefix}: sink slider updates uniform and pixels`, { before: before.hash, after: after.hash });

  for (const mode of ['clay', 'height', 'pbr']) {
    await page.selectOption('#mode', mode);
    await page.waitForTimeout(200);
    assert.equal((await page.evaluate(() => __POM_ASSET_LAB__.snapshot())).glError, 0);
    test(`${prefix}: display ${mode}`);
  }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, `${prefix}-oblique.png`), fullPage: true });
  return initial;
}

try {
  const local = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  report.local = await runPage(local, localUrl, 'local');
  await local.close();

  if (process.env.GITHUB_SHA) {
    // rawcdn is the immutable production endpoint. It serves the exact commit
    // directly and does not show raw.githack's interactive confirmation page.
    const hostedUrl = `https://rawcdn.githack.com/EckZar/test_case/${process.env.GITHUB_SHA}/shipmodule-pom-lab/pull-rail.html`;
    let hostedError;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const hosted = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
      try {
        report.hosted = { url: hostedUrl, state: await runPage(hosted, hostedUrl, 'hosted') };
        hostedError = null;
        await hosted.close();
        break;
      } catch (error) {
        hostedError = error;
        await hosted.screenshot({ path: path.join(output, `hosted-attempt-${attempt}.png`), fullPage: true }).catch(() => {});
        await hosted.close();
        if (attempt < 8) await new Promise(resolve => setTimeout(resolve, 15000));
      }
    }
    if (hostedError) throw hostedError;
  }
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
