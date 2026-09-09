import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron } from 'playwright';
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
const policy=await server.ssrLoadModule('/src/main/window-policy.ts');
const dir=await mkdtemp(join(tmpdir(),'allchat-copy-check-'));
await writeFile(join(dir,'main.cjs'), `const {app,BrowserWindow,session}=require('electron');
const isAllowedRendererPermission=${policy.isAllowedRendererPermission.toString()};
app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((wc,p,cb)=>cb(isAllowedRendererPermission(p,BrowserWindow.fromWebContents(wc)!==null)));
 session.defaultSession.setPermissionCheckHandler((wc,p)=>isAllowedRendererPermission(p,!!wc&&BrowserWindow.fromWebContents(wc)!==null));
 const win=new BrowserWindow({width:960,height:640,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 win.loadURL(${JSON.stringify(server.resolvedUrls.local[0]+'image-message-check')});
});`);
let electron;
try {
 electron=await _electron.launch({args:[join(dir,'main.cjs'),'--no-sandbox']});
 electron.process().stdout.on('data',data=>process.stdout.write(data));
 const page=await electron.firstWindow();
 page.on('console',msg=>{if(msg.type()==='error')console.log(msg.text());});
 await page.waitForFunction(()=>typeof window.showImages==='function');
 await page.evaluate(()=>window.showImages(1));
 const image=page.getByRole('button',{name:'View Trail 0.png at full size'});
 await image.waitFor();
 for(const expanded of [false,true]) {
 await electron.evaluate(({clipboard})=>clipboard.clear());
 if(expanded) await image.click();
 const target=expanded?page.getByRole('dialog').getByRole('img'):image;
 await target.click({button:'right'});
 await page.getByRole('menuitem',{name:'Copy image'}).click();
 await page.waitForFunction(()=>!document.querySelector('[role=menu]')||document.querySelector('[role=alert]'));
 const error=await page.getByRole('alert').count() ? await page.getByRole('alert').textContent() : null;
 assert.equal(error,null,'Copy must succeed with the desktop permission policy');
 const size=await electron.evaluate(({clipboard})=>clipboard.readImage().getSize());
 assert.deepEqual(size,{width:1280,height:720});
 }
 console.log('Electron copy passes with the desktop permission policy; clipboard contains original-size image.');
} finally {if(electron)await electron.close();await server.close();await rm(dir,{recursive:true,force:true});}
