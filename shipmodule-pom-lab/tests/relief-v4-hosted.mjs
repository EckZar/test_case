import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium }=await import(process.env.POM_PLAYWRIGHT_PATH);
const url='https://raw.githack.com/EckZar/test_case/192e6bdcd71c1f06a871b814379ed287c29aaee7/shipmodule-pom-lab/hatch512.html';
const out='pom-v4-hosted-evidence';await mkdir(out,{recursive:true});
const report={url,runtimeCommit:'192e6bdcd71c1f06a871b814379ed287c29aaee7',passed:false,errors:[],requests:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
let page=await context.newPage();
context.on('page',p=>{page=p;});
function observe(p){p.on('pageerror',e=>report.errors.push(e.message));p.on('response',r=>{if(r.url().includes('shipmodule-pom-lab'))report.requests.push({url:r.url(),status:r.status()});});}
observe(page);context.on('page',observe);
try{
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
 // Follow the host's normal visible confirmation. This is not a rendering error.
 const confirmation=page.getByText('Open the page',{exact:true}).first();
 if(await confirmation.isVisible({timeout:10000}).catch(()=>false)){
   report.hostConfirmation=true;await confirmation.click();
 }
 await page.waitForFunction(()=>window.__POM_LAB__?.ready||window.__POM_LAB__?.errors?.length,null,{timeout:90000});
 const state=await page.evaluate(()=>({ready:__POM_LAB__.ready,size:__POM_LAB__.size,errors:__POM_LAB__.errors,parameters:__POM_LAB__.parameters,programKey:__POM_LAB__.programKey,maps:__POM_LAB__.maps,snapshot:__POM_LAB__.snapshot()}));
 assert.equal(state.ready,true,JSON.stringify(state));assert.equal(state.size,512);assert.match(state.programKey,/v4/);assert.deepEqual(state.errors,[]);assert.equal(state.snapshot.glError,0);assert.ok(state.snapshot.variance>25);assert.deepEqual(report.errors,[]);
 report.state=state;await page.screenshot({path:out+'/hosted-front.png'});
 await page.evaluate(()=>__POM_LAB__.cameraPreset('oblique'));await page.waitForTimeout(500);
 await page.locator('#sinkScale').evaluate(e=>{e.value='1.8';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForFunction(()=>__POM_LAB__.parameters.sinkScale===1.8,null,{timeout:10000});
 report.updatedUniform=await page.evaluate(()=>__POM_LAB__.uniforms().pomSinkScale);assert.equal(report.updatedUniform,1.8);
 report.after=await page.evaluate(()=>__POM_LAB__.snapshot());assert.equal(report.after.glError,0);
 await page.evaluate(()=>{__POM_LAB__.setParameters({sinkScale:1.25});document.querySelector('aside').scrollTop=0;});
 await page.waitForTimeout(500);await page.screenshot({path:out+'/hosted-oblique.png'});report.passed=true;report.finalUrl=page.url();
}catch(e){report.failure=e.stack;report.finalUrl=page.url();report.text=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:out+'/hosted-failure.png'}).catch(()=>{});process.exitCode=1;}
finally{await writeFile(out+'/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
