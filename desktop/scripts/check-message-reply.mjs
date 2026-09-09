import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const fixture=`<!doctype html><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {ReplyComposerPreview,ReplyExcerpt} from '/src/renderer/message-reply.tsx';import '/src/renderer/styles.css';
const root=createRoot(document.getElementById('root'));
window.renderReply=width=>root.render(React.createElement('div',{className:'message-list',style:{width,height:600,background:'#17181c'}},
 React.createElement('article',{className:'message has-reply'},React.createElement('span',{className:'avatar'},'A'),React.createElement('div',null,
 React.createElement(ReplyExcerpt,{reply:{message_id:'original',author_name:'sam',body:'Can you share the latest mockups?',deleted:false}}),React.createElement('strong',{id:'author'},'Alex'),React.createElement('div',{className:'message-body'},'Here are the updated screens.'))),
 React.createElement('div',{className:'message-composer-wrap'},React.createElement('form',{className:'message-composer'},
 React.createElement(ReplyComposerPreview,{message:{author_name:'sam',body:'A very long quoted message '.repeat(15),deleted:false},onCancel:()=>window.cancelled=true}),
 React.createElement('textarea',{defaultValue:'Here are the updated screens.'}),React.createElement('button',null,'+')))));
window.renderReply(728);
</script>`;
const server=await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),plugins:[react(),{name:'reply-fixture',configureServer(s){s.middlewares.use('/reply-check',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/reply-check',fixture));});}}],server:{host:'127.0.0.1',port:0}});
await server.listen();const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'reply-check');await page.locator('.reply-composer-preview').waitFor();
 for(const width of [728,360,280]){
  await page.evaluate(w=>window.renderReply(w),width);await page.waitForFunction(w=>document.querySelector('.message-list').clientWidth===w,width);
  const quote=await page.locator('.message-reply-excerpt').boundingBox(),author=await page.locator('#author').boundingBox();assert.ok(quote.y+quote.height<=author.y,'Quote above author');
  const preview=await page.locator('.reply-composer-preview').boundingBox(),input=await page.locator('textarea').boundingBox();assert.ok(preview.y+preview.height<=input.y,'Preview above input');
  const contained=await page.locator('.reply-composer-preview').evaluate(e=>e.scrollWidth<=e.clientWidth);assert.ok(contained,'Long quote contained');
  const close=await page.getByRole('button',{name:'Cancel reply'}).boundingBox();assert.ok(close.x>=preview.x&&close.x+close.width<=preview.x+preview.width);
 }
 await page.getByRole('button',{name:'Cancel reply'}).click();assert.equal(await page.evaluate(()=>window.cancelled),true);
 await page.screenshot({path:'/tmp/message-reply.png'});console.log('Reply layout passes at full and narrow widths: excerpt above author, composer preview, truncation, and cancel.');
}finally{await browser.close();await server.close();}
