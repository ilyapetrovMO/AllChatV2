import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {captureVector} from './capture-vector.mjs';
const output=new URL('./sketchboard-reference/',import.meta.url);await fs.mkdir(output,{recursive:true});
const toolbarOnly=process.argv.includes('--toolbar-only');
const browser=await chromium.launch({headless:true});const items=toolbarOnly?JSON.parse(await fs.readFile(new URL('manifest.json',output),'utf8')).items:[];
try {
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4187',viewport:{width:1280,height:900},locale:'en-US',reducedMotion:'reduce'});
 await context.request.get('/login');const csrf=(await context.cookies()).find(c=>c.name==='allchat_csrf')?.value||'';
 const login=await context.request.post('/api/v1/auth/login',{data:{username:'visual-owner',password:'visual regression password'},headers:{'X-CSRF-Token':csrf}});if(!login.ok())throw Error('Fixture login failed');
 const ownerCSRF=(await context.cookies()).find(c=>c.name==='allchat_csrf')?.value||'';
 const enabled=await context.request.put('/api/v1/admin/activities/allchat.sketchboard',{data:{enabled:true},headers:{'X-CSRF-Token':ownerCSRF}});if(!enabled.ok())throw Error('Could not enable fixture activity '+enabled.status());
 const page=await context.newPage();const response=await page.goto('/activities/allchat.sketchboard');if(!response.ok())throw Error('Activity host unavailable '+response.status());
 const element=await page.locator('iframe').elementHandle();const frame=await element.contentFrame();await frame.locator('#board-grid').waitFor();await frame.waitForFunction(()=>!document.querySelector('#activity-status').textContent.includes('Loading'));
 async function capture(name){
  await frame.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:new URL(name+'.png',output).pathname,fullPage:true});
  const vector=await captureVector(frame,{fullPage:true});await fs.writeFile(new URL(name+'.svg',output),vector.svg);
  const controls=await frame.locator('button,input,canvas,output').evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName.toLowerCase(),id:e.id,label:e.getAttribute('aria-label')||e.textContent||e.getAttribute('placeholder')||'',title:e.title,type:e.type,selected:e.classList.contains('active'),disabled:!!e.disabled,visible:!!(r.width&&r.height),bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};}));
  await fs.writeFile(new URL(name+'.json',output),JSON.stringify({controls},null,2)+'\n');items.push({name,screenshot:name+'.png',vector:name+'.svg',controls:name+'.json',status:'capture; iframe host offset and canvas reconstruction pending'});
  await fs.writeFile(new URL('manifest.json',output),JSON.stringify({source:'internal/instance/web/activities/sketchboard/index.html',items},null,2)+'\n');
 }
 if(toolbarOnly){
  const card=frame.locator('.board-card').filter({hasText:'Catalog sketch'}).first();await card.getByRole('button',{name:'Enter',exact:true}).click();await frame.locator('#board-workspace').waitFor();await frame.waitForFunction(()=>document.querySelector('#board-participants').textContent.length>0);
  await frame.locator('.sketch-tools').evaluate(e=>{e.scrollLeft=e.scrollWidth;});await capture('workspace-toolbar-right');
 } else {
 await capture('board-list');
 await frame.getByLabel('Board name').fill('Catalog sketch');await frame.locator('#create-board-button').click();
 const card=frame.locator('.board-card').filter({hasText:'Catalog sketch'}).last();await card.waitFor();await capture('board-list-populated');
 await card.getByRole('button',{name:'Delete',exact:true}).click();await capture('delete-confirmation');
 await card.getByRole('button',{name:'Enter',exact:true}).click();await frame.locator('#board-workspace').waitFor();await frame.waitForFunction(()=>document.querySelector('#board-participants').textContent.length>0);await capture('workspace-pen');
 for(const tool of ['highlighter','line','rectangle','ellipse','text','note','eraser','pan']){await frame.locator(`[data-tool="${tool}"]`).click();await capture('workspace-'+tool);}
 await frame.locator('#clear-board').click();await capture('clear-confirmation');
 }
 console.log(`Captured ${items.length} Sketchboard states.`);
} finally {await browser.close();}
