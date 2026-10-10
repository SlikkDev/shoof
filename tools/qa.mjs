import { createRequire } from 'node:module';
import { mkdir,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startPreview } from './serve.mjs';
if(!process.env.REPORTING_QA_PACKAGE||!process.env.REPORTING_QA_BROWSER)throw new Error('Point QA at an existing external Playwright package and browser executable.');
const require=createRequire(process.env.REPORTING_QA_PACKAGE),{chromium}=require('playwright');
const server=await startPreview({env:{},port:0}),origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.REPORTING_QA_BROWSER});
const output=new URL('../artifacts/',import.meta.url);await mkdir(output,{recursive:true});
const errors=[],external=[];const page=await browser.newPage({viewport:{width:1440,height:1100},locale:'en-US',timezoneId:'Etc/UTC',reducedMotion:'reduce'});
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin+'/'))external.push(new URL(r.url()).origin);});
try{
 await page.goto(origin);await page.getByRole('heading',{name:'The whole picture.'}).waitFor();
 assert.match(await page.locator('#mode-banner').innerText(),/Fictional demonstration/);
 assert.equal(await page.locator('.metric[data-status="available"]').count(),7);
 await page.screenshot({path:new URL('demo-results-desktop.png',output).pathname,fullPage:true});
 await page.locator('[data-metric="mediaSpend"]').click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);
 await page.locator('[data-view="funnel"]').click();await page.locator('.stage').first().waitFor();assert.equal(await page.locator('.stage').count(),5);
 await page.locator('[data-view="channels"]').click();await page.locator('.channel').first().waitFor();assert.equal(await page.locator('.channel').count(),12);
 await page.locator('[data-filter="Content"]').click();assert.equal(await page.locator('.channel').count(),3);
 await page.locator('[data-filter="All"]').click();await page.getByRole('searchbox').fill('none-such');await page.getByRole('status').filter({hasText:'No matching'}).waitFor();await page.getByRole('searchbox').fill('');
 await page.screenshot({path:new URL('demo-channels-desktop.png',output).pathname,fullPage:true});
 await page.locator('[data-view="health"]').click();await page.locator('tbody tr').first().waitFor();assert.equal(await page.locator('tbody tr').count(),12);
 await page.screenshot({path:new URL('demo-health-desktop.png',output).pathname,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 for(const view of ['results','funnel','channels','health']){await page.locator(`[data-view="${view}"]`).click();await page.locator(`[data-view="${view}"][aria-current="page"]`).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,view);if(view==='results')await page.screenshot({path:new URL('demo-results-mobile.png',output).pathname,fullPage:true});}
 await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>{window.print=()=>{window.printCalled=true;};});await page.getByRole('button',{name:'Print report'}).click();await page.waitForFunction(()=>window.printCalled===true);await page.pdf({path:new URL('demo-report.pdf',output).pathname,format:'A4',printBackground:true});
 assert.equal((await page.request.post(origin+'/api/report')).status(),405);
 for(const path of ['/.env','/examples/snapshot.demo.json','/AGENTS.md','/src/tenant.mjs'])assert.equal((await page.request.get(origin+path)).status(),404);
 const wire=await (await page.request.get(origin+'/api/report')).json();assert.equal('workspaceId' in wire,false);assert.equal(JSON.stringify(wire).includes('demo-account'),false);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={passed:true,mode:'fictional-demo',views:4,desktop:'1440x1100',mobile:'390x844',mobileOverflow:false,consoleErrors:errors,externalRequests:external,rawIdentityFieldsExposed:false,privateInputBuildRefusedByUnitTest:true};
 await writeFile(new URL('qa.json',output),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
