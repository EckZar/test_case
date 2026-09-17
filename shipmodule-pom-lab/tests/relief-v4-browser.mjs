import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.POM_PLAYWRIGHT_PATH || 'playwright');
const root=process.cwd(),out=path.join(root,'pom-v4-evidence');await mkdir(out,{recursive:true});
const mime={'.js':'application/javascript','.html':'text/html','.json':'application/json','.png':'image/png','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep))throw new Error('Invalid path');const body=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/shipmodule-pom-lab/`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const report={commit:process.env.GITHUB_SHA||'local',tests:[],errors:[],passed:false};
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
page.on('pageerror',e=>report.errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))report.errors.push(m.text());});
const test=(name,data={})=>report.tests.push({name,passed:true,...data});
const good=async()=>{const s=await page.evaluate(()=>window.__POM_LAB__.snapshot());assert.equal(s.glError,0);assert.ok(s.max-s.min>30);assert.ok(s.variance>25);return s;};
try{
 await page.goto(base+'hatch512.html',{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__POM_LAB__?.ready||window.__POM_LAB__?.errors.length,{timeout:60000});
 let state=await page.evaluate(()=>({ready:__POM_LAB__.ready,errors:__POM_LAB__.errors,size:__POM_LAB__.size,maps:__POM_LAB__.maps,key:__POM_LAB__.programKey}));
 assert.equal(state.ready,true,JSON.stringify(state));assert.equal(state.size,512);assert.match(state.key,/v4/);assert.equal(Object.keys(state.maps).length,5);test('512 source checksums and v4 shader compile',state);
 for(const kind of['front','oblique','grazing']){await page.evaluate(k=>__POM_LAB__.cameraPreset(k),kind);await page.waitForTimeout(350);test('Rendered '+kind,await good());await page.screenshot({path:path.join(out,kind+'.png')});}
 await page.evaluate(()=>__POM_LAB__.cameraPreset('oblique'));await page.waitForTimeout(350);
 for(const [field,lo,hi]of[['raiseScale',0,2],['sinkScale',0,2],['neutralLevel',.2,.8],['wallSoftnessPx',0,2],['heightScale',0,.06]]){
  await page.evaluate(([k,v])=>__POM_LAB__.setParameters({[k]:v}),[field,lo]);const a=await good();
  await page.evaluate(([k,v])=>__POM_LAB__.setParameters({[k]:v}),[field,hi]);const b=await good();assert.notEqual(a.hash,b.hash,field+' does not affect pixels');test(field+' changes rendered image',{low:a.hash,high:b.hash});
  await page.click('#reset');await page.evaluate(()=>__POM_LAB__.cameraPreset('oblique'));await page.waitForTimeout(250);
 }
 // Exercise real DOM input events, not just the testing API.
 await page.locator('#sinkScale').evaluate(e=>{e.value='1.8';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>Math.abs(__POM_LAB__.parameters.sinkScale-1.8)<1e-6);assert.equal(await page.evaluate(()=>__POM_LAB__.uniforms().pomSinkScale),1.8);test('UI slider -> uniform');
 for(const mode of['clay','height','pbr']){await page.selectOption('#mode',mode);await page.waitForTimeout(200);test('Display '+mode,await good());}
 await page.check('#cutout');await page.waitForTimeout(200);test('Alpha cutout',await good());await page.uncheck('#cutout');
 await page.evaluate(()=>__POM_LAB__.setParameters({heightScale:.12,raiseScale:.35,sinkScale:1.25,maxSteps:128,refinementSteps:8,jitterStrength:.35}));
 await page.evaluate(()=>__POM_LAB__.cameraPreset('grazing'));await page.waitForTimeout(300);test('Stress 128 steps + 8 refinement + optional jitter',await good());
 await page.evaluate(()=>__POM_LAB__.setParameters({raiseScale:0,sinkScale:0}));test('Both gains zero',await good());
 await page.click('#reset');await page.evaluate(()=>__POM_LAB__.cameraPreset('oblique'));await page.waitForTimeout(350);await page.screenshot({path:path.join(out,'recommended.png')});
 assert.deepEqual(report.errors,[]);test('No browser / GLSL errors');report.passed=true;
 // Test the actual immutable public URL too. CDN availability is reported
 // separately from local render correctness; never silently substitute a page.
 if(process.env.GITHUB_SHA){
  const remote=await browser.newPage({viewport:{width:1440,height:960}});const re=[];remote.on('pageerror',e=>re.push(e.message));
  const url=`https://raw.githack.com/EckZar/test_case/${process.env.GITHUB_SHA}/shipmodule-pom-lab/hatch512.html`;
  try{await remote.goto(url,{waitUntil:'networkidle',timeout:90000});
   if(await remote.locator('a').filter({hasText:/continue/i}).count())await remote.locator('a').filter({hasText:/continue/i}).first().click();
   await remote.waitForFunction(()=>window.__POM_LAB__?.ready||window.__POM_LAB__?.errors.length,{timeout:60000});
   const r=await remote.evaluate(()=>({ready:__POM_LAB__.ready,key:__POM_LAB__.programKey,errors:__POM_LAB__.errors,snapshot:__POM_LAB__.snapshot()}));
   assert.ok(r.ready);assert.match(r.key,/v4/);assert.deepEqual(r.errors,[]);assert.deepEqual(re,[]);assert.equal(r.snapshot.glError,0);
   await remote.screenshot({path:path.join(out,'hosted.png')});report.hosted={passed:true,url,...r};
  }catch(e){report.hosted={passed:false,url,error:e.message};await remote.screenshot({path:path.join(out,'hosted-unavailable.png')}).catch(()=>{});}
  await remote.close();
 }
}catch(e){report.passed=false;report.failure=e.stack;process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();server.close();}
