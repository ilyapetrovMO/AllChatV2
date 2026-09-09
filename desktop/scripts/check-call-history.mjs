import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const fixture=`<!doctype html><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {CallHistoryEvent} from '/src/renderer/call-history-event.tsx';import '/src/renderer/styles.css';
const call={id:'call',direct_message_id:'dm',caller_id:'sam',recipient_id:'me',created_at:'2026-09-09T10:25:00Z',accepted_at:'2026-09-09T10:25:05Z',finished_at:'2026-09-09T10:37:39Z'};
const root=createRoot(document.getElementById('root'));
window.showHistory=(width,name='sam')=>root.render(React.createElement('div',{className:'message-list',style:{width,background:'#17181c',height:700}},['ringing','accepted','ended','missed','declined'].map((state,i)=>React.createElement(CallHistoryEvent,{key:state,currentMemberId:'me',otherName:name,message:{id:state,channel_id:'dm',author_id:'sam',author_name:'sam',sequence:i,created_at:call.created_at,deleted:false,call_event:{...call,state}}}))));
window.showHistory(968);
</script>`;
const server=await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),plugins:[react(),{name:'call-history-fixture',configureServer(s){s.middlewares.use('/history-check',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/history-check',fixture));});}}],server:{host:'127.0.0.1',port:0}});
await server.listen();const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0]+'history-check');await page.locator('.call-history-event').first().waitFor();
 for(const width of [968,360,280])for(const name of ['sam','A very long participant display name']){
  await page.evaluate(({width,name})=>window.showHistory(width,name),{width,name});
  await page.waitForFunction(w=>document.querySelector('.message-list').clientWidth===w,width);
  for(const row of await page.locator('.call-history-event').all()){
   const bounds=await row.boundingBox(),label=await row.locator('.call-history-label').boundingBox(),time=await row.locator('time').boundingBox();
   assert.ok(Math.abs(label.x+label.width/2-bounds.x-bounds.width/2)<1,'Label centered');
   assert.ok(time.y+time.height<=label.y,'Timestamp above label');
   assert.ok(label.x>=bounds.x&&label.x+label.width<=bounds.x+bounds.width,'Label contained');
   const lines=await row.locator('.call-history-divider').evaluate(e=>['::before','::after'].map(p=>parseFloat(getComputedStyle(e,p).width)));
   assert.ok(Math.abs(lines[0]-lines[1])<1&&lines[0]>=12,'Equal visible dividers');
  }
 }
 assert.deepEqual(errors,[]);console.log('Call history passes: five states, centered dividers, timestamps above, narrow panels, and long names.');
 await page.screenshot({path:'/tmp/dm-call-history.png'});
}finally{await browser.close();await server.close();}
