import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const fixture = `<!doctype html><div id="root" style="width:560px;margin:24px"></div><script type="module">
import React from 'react';
import ReactDOMClient from 'react-dom/client';
import ReactDOM from 'react-dom';
import { MessageAttachments } from '/src/renderer/app.tsx';
import { InlineMessageEditor } from '/src/renderer/inline-message-editor.tsx';
import '/src/renderer/styles.css';
const root=ReactDOMClient.createRoot(document.getElementById('root'));
const data=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#617d98"/><path d="M0 720 420 120 800 720M460 720 960 220 1280 720" fill="#314c55"/></svg>');
window.showEditor=()=>ReactDOM.flushSync(()=>root.render(React.createElement('article',{className:'message message-editing'},React.createElement('span',{className:'avatar'},'A'),React.createElement('div',null,React.createElement('strong',null,'Alex'),React.createElement(InlineMessageEditor,{body:'A message to edit',onSave:async value=>{window.saved=value;return true;},onClose:()=>{window.editorClosed=true;}})))));
</script>`;
const server=await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),plugins:[react(),{
  name:'image-message-fixture',configureServer(server){server.middlewares.use('/image-message-check',async(_req,res)=>{
    res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/image-message-check',fixture));
  });}
}],server:{host:'127.0.0.1',port:0}});
await server.listen();
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:960,height:640}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'image-message-check');
  await page.waitForFunction(()=>typeof window.showEditor==='function');
  await page.evaluate(()=>window.showEditor());
  const input=page.getByRole('textbox');
  for(const width of [700,320]) {
    await page.locator('#root').evaluate((el,width)=>el.style.width=width+'px',width);
    await input.fill('One line');
    const short=await input.boundingBox();
    assert.equal(short.height,56);
    await input.fill(Array.from({length:30},(_,i)=>'Line '+i).join('\n'));
    const tall=await input.boundingBox();
    assert.equal(tall.height,240);
    assert.ok(tall.width<width);
    await page.locator('#root').screenshot({path:'/tmp/inline-edit-'+width+'.png'});
  }
  await input.fill('Save this edit');
  await input.press('Enter');
  await page.waitForFunction(()=>window.editorClosed);
  assert.equal(await page.evaluate(()=>window.saved),'Save this edit');
  assert.deepEqual(errors,[]);
  console.log('Inline editor browser checks pass: narrow/wide sizing, auto-grow capped at 240px, Enter saves.');
} finally {await browser.close();await server.close();}
