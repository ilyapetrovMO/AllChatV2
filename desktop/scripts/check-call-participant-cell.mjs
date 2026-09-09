import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const fixture = `<!doctype html><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CallParticipantCell} from '/src/renderer/call-participant-cell.tsx';
import '/src/renderer/styles.css';
const root = createRoot(document.getElementById('root'));
window.loads = 0;
const onAction = async ({path}) => {
 window.loads++;
 if(path === 'missing') throw new Error('Unavailable');
 const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="'+path+'"/></svg>';
 return {type:'asset', data:new TextEncoder().encode(svg), contentType:'image/svg+xml'};
};
window.renderCell = (avatarPath, direct=false, focused=false) => flushSync(()=>root.render(
 React.createElement('section',{className:'media-stage'+(direct?' direct-call-stage':''),style:{width:600,height:400}},
 React.createElement(CallParticipantCell,{name:'Alex',avatarPath,onAction,'data-media-member-id':'alex',className:focused?'expanded':''},React.createElement('strong',null,'Alex')))
));
window.renderCell('#237c73');
</script>`;
const server = await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),plugins:[react(),{
 name:'cell-fixture',configureServer(server){server.middlewares.use('/cell-check',async(_req,res)=>{
 res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/cell-check',fixture));
 });}
}],server:{host:'127.0.0.1',port:0}});
await server.listen();
const browser = await chromium.launch();
try {
 const page = await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0]+'cell-check');
 const checkColor = async color => page.waitForFunction(color=>getComputedStyle(document.querySelector('.participant-tile')).backgroundColor===color,color);
 await checkColor('rgb(35, 124, 115)');
 assert.equal(await page.locator('.participant-tile').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
 for(const direct of [false,true]) {
  await page.evaluate(direct=>window.renderCell('#f0e0c0',direct),direct);
  await checkColor('rgb(240, 224, 192)');
  assert.equal(await page.locator('.participant-tile').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 0)');
  await page.evaluate(direct=>window.renderCell('#f0e0c0',direct,true),direct);
  await checkColor('rgb(240, 224, 192)');
 }
 assert.equal(await page.evaluate(()=>window.loads),2,'Focusing or switching presentation must not reload avatars');
 await page.evaluate(()=>{const video=document.createElement('video');video.className='desktop-shared-screen';document.querySelector('.media-stage-visual').append(video);});
 assert.equal(await page.locator('.media-stage-avatar').evaluate(e=>getComputedStyle(e).display),'none');
 await page.evaluate(()=>window.renderCell('missing'));
 await checkColor('rgb(109, 117, 232)');
 assert.equal(await page.locator('.media-stage-avatar').textContent(),'A');
 await page.evaluate(()=>window.renderCell(undefined,true));
 await checkColor('rgb(109, 117, 232)');
 assert.deepEqual(errors,[]);
 console.log('Shared call cells: avatar colors, contrast, avatar changes, fallback, focus, and screen-share visibility passed.');
} finally {await browser.close();await server.close();}
