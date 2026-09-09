import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron} from 'playwright';
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'allchat-font-check-'));
let app;
try{
 app=await electron.launch({executablePath:path.resolve('desktop/out/AllChat-linux-x64/AllChat'),args:[`--user-data-dir=${profile}`,'--no-sandbox']});
 const page=await app.firstWindow();await page.getByLabel('Community address').waitFor();await page.evaluate(()=>document.fonts.ready);
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root}=await cdp.send('DOM.getDocument');const results=[];
 for(const selector of ['.empty-state h1','.eyebrow','.empty-state > p:not(.eyebrow)','.onboarding-form label','.onboarding-form input','.onboarding-form button']){
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
  const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
  results.push({selector,fonts,computed:await page.locator(selector).evaluate(e=>{const s=getComputedStyle(e);return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,textTransform:s.textTransform}})});
 }
 await fs.writeFile('design/penpot/desktop-rendered-fonts.json',JSON.stringify({platform:'Electron Linux',results},null,2)+'\n');
 console.log(JSON.stringify(results.map(r=>({selector:r.selector,fonts:r.fonts}))));
}finally{await app?.close();await fs.rm(profile,{recursive:true,force:true});}
