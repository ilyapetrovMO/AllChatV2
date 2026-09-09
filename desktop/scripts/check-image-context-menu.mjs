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
import '/src/renderer/styles.css';
const root=ReactDOMClient.createRoot(document.getElementById('root'));
const data=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#617d98"/><path d="M0 720 420 120 800 720M460 720 960 220 1280 720" fill="#314c55"/></svg>');
window.showImages=count=>ReactDOM.flushSync(()=>root.render(React.createElement(MessageAttachments,{
  attachments:Array.from({length:count},(_,i)=>({id:String(i),name:'Trail '+i+'.png',content_type:'image/png',size:4096,url:'/image/'+i})),
  onAction:async()=>({type:'asset',contentType:'image/svg+xml',data})
})));
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
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await page.waitForFunction(()=>typeof window.showImages==='function');
  for(const width of [560,280]) {
    await page.locator('#root').evaluate((el,width)=>el.style.width=width+'px',width);
    for(const count of [1,4,10]) {
      await page.evaluate(count=>window.showImages(count),count);
      await page.waitForFunction(count=>document.querySelectorAll('.message-image img').length===count && [...document.querySelectorAll('.message-image img')].every(i=>i.complete&&i.naturalWidth),count);
      const boxes=await page.locator('.message-image img').evaluateAll(images=>images.map(i=>{const b=i.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height};}));
      for(const box of boxes) {
        assert.ok(Math.abs(box.w/box.h-16/9)<.01,JSON.stringify(box));
        assert.ok(box.w<=width);
      }
      if(count>1) {
        assert.equal(boxes[0].y,boxes[1].y);
        assert.equal(boxes[1].x-boxes[0].x-boxes[0].w,8);
        assert.equal(boxes[2].y-boxes[0].y-boxes[0].h,8);
      }
      assert.equal(await page.locator('figure,figcaption,a[download]').count(),0);
      await page.locator('#root').screenshot({path:'/tmp/message-images-'+width+'-'+count+'.png'});
      await page.getByRole('button',{name:'View Trail 0.png at full size'}).click();
      await page.getByRole('dialog').waitFor();
      const expanded=page.getByRole('dialog').getByRole('img');
      await expanded.dispatchEvent('contextmenu',{clientX:950,clientY:630});
      let menu=page.getByRole('menu',{name:'Image actions'});
      await menu.waitFor();
      const bounds=await menu.boundingBox();
      assert.ok(bounds.x+bounds.width<=952 && bounds.y+bounds.height<=632,'Menu fits window');
      assert.equal(await menu.getByText('Trail 0.png').count(),1);
      await page.keyboard.press('Escape');
      await menu.waitFor({state:'detached'});
      assert.equal(await page.getByRole('dialog').count(),1,'Escape closes menu before viewer');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({state:'detached'});
      await page.getByRole('button',{name:'View Trail 0.png at full size'}).click({button:'right'});
      menu=page.getByRole('menu',{name:'Image actions'});
      await menu.waitFor();
      await menu.getByRole('menuitem',{name:'Copy image'}).click();
      await menu.waitFor({state:'detached'});
      assert.equal(await page.evaluate(async()=>(await navigator.clipboard.read())[0].types[0]),'image/png');
      await page.getByRole('button',{name:'View Trail 0.png at full size'}).press('Shift+F10');
      const downloadEvent=page.waitForEvent('download');
      await page.getByRole('menuitem',{name:'Download'}).click();
      const download=await downloadEvent;
      assert.equal(download.suggestedFilename(),'Trail 0.png');
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Image context menus pass: preview/viewer, viewport fitting, Escape ordering, real PNG clipboard writes and original downloads.');
} finally {await browser.close();await server.close();}
