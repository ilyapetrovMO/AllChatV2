import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const fixture = `<!doctype html><div id="root"></div><script type="module">
import React from 'react';
import ReactDOMClient from 'react-dom/client';
import ReactDOM from 'react-dom';
import { VoiceMemberMenu, SoundboardMenu } from '/src/renderer/app.tsx';
import '/src/renderer/styles.css';
const root=ReactDOMClient.createRoot(document.getElementById('root'));
const noop=()=>{};
window.showMenu=kind=>ReactDOM.flushSync(()=>root.render(React.createElement(VoiceMemberMenu,{
  name:kind==='self'?'Alex':'sam',context:kind==='self'?'You · Lounge':'In Lounge',
  avatar:React.createElement('span',{className:'voice-menu-avatar'},kind==='self'?'A':'S'),presence:'online',
  self:kind==='self',canModerate:kind==='owner',serverMuted:false,volume:1,
  left:innerWidth-20,top:innerHeight-20,
  onVolume:noop,onProfile:noop,onMessage:noop,onMute:noop,onDisconnect:noop,onCopy:noop,onClose:noop
})));
window.showSounds=count=>ReactDOM.flushSync(()=>root.render(React.createElement(SoundboardMenu,{
  sounds:Array.from({length:count},(_,i)=>({id:String(i),name:i===9?'A very long Community sound name':i?'Celebration':'Airhorn'})),onPlay:noop,onClose:noop
})));
</script>`;
const server=await createServer({configFile:false,root:fileURLToPath(new URL('..',import.meta.url)),plugins:[react(),{
  name:'voice-overlays-fixture',configureServer(server){server.middlewares.use('/voice-overlay-check',async(_req,res)=>{
    res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/voice-overlay-check',fixture));
  });}
}],server:{host:'127.0.0.1',port:0}});
await server.listen();
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:960,height:640}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'voice-overlay-check');
  await page.waitForFunction(()=>typeof window.showMenu==='function');
  for(const kind of ['self','member','owner']){
    await page.evaluate(kind=>window.showMenu(kind),kind);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const menu=page.getByRole('menu');const bounds=await menu.boundingBox();
    assert.equal(await page.locator('.voice-menu-avatar').evaluate(el=>getComputedStyle(el).display),'grid','Avatar initials remain centered');
    assert.equal(bounds.width,288);
    assert.ok(bounds.x>=8&&bounds.y>=8&&bounds.x+bounds.width<=952.1&&bounds.y+bounds.height<=632.1, JSON.stringify({kind,bounds}));
    await menu.screenshot({path:'/tmp/voice-menu-app-'+kind+'.png'});
  }
  await page.setViewportSize({width:600,height:360});
  await page.waitForTimeout(50);
  const small=await page.getByRole('menu').boundingBox();
  assert.ok(small.x+small.width<=592&&small.y+small.height<=352,'Owner menu must remain inside resized viewport');
  await page.setViewportSize({width:960,height:640});
  for(const count of [0,2,10,40]){
    await page.evaluate(count=>window.showSounds(count),count);
    const panel=page.getByRole('dialog');
    assert.equal((await panel.boundingBox()).width,360);
    if(count){
      const tiles=await page.locator('.soundboard-sounds button').evaluateAll(buttons=>buttons.map(b=>({w:b.offsetWidth,h:b.offsetHeight})));
      assert.equal(tiles.length,count);
      assert.ok(tiles.every(t=>t.h===44&&t.w<=158));
      if(count===10) assert.equal((await panel.boundingBox()).height,332);
      if(count===40){
        const header=await panel.locator('header').boundingBox();
        const scroll=await page.locator('.soundboard-sounds').evaluate(e=>{e.scrollTop=e.scrollHeight;return {scroll:e.scrollTop,overflow:e.scrollHeight>e.clientHeight};});
        assert.ok(scroll.overflow&&scroll.scroll>0,'Large sound collections must scroll');
        assert.deepEqual(await panel.locator('header').boundingBox(),header,'Header stays fixed');
      }
    }
    await panel.screenshot({path:'/tmp/soundboard-app-'+count+'.png'});
  }
  assert.deepEqual(errors,[]);
  console.log('Voice overlays pass: self/member/owner, viewport fitting, 44px sound tiles, 10 sounds, and scrolling 40 sounds.');
} finally {await browser.close();await server.close();}
