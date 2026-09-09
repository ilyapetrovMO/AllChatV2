import {chromium} from '/home/gosha/src/AllChatV2/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:960,height:900}});
await page.goto('file:///tmp/allchat-login-interactive/desktop/prototypes/login.prototype.html');
await page.evaluate(()=>document.fonts.ready);
await page.addStyleTag({content:'.app-viewport{height:640px}.app-viewport .shell,.app-viewport .content{height:612px}'});
const results=[];
for(const mode of ['Sign in','Register','Recovery']){
 await page.getByRole('button',{name:mode,exact:true}).first().click();
 results.push(await page.evaluate(mode=>{const c=document.querySelector('.content'),f=document.querySelector('.empty-state'),v=document.querySelector('#viewport');const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};return {mode,viewport:rect(v),content:rect(c),form:rect(f),scrollHeight:c.scrollHeight,clientHeight:c.clientHeight,scrollWidth:c.scrollWidth,clientWidth:c.clientWidth}},mode));
 await page.locator('#viewport').screenshot({path:`/home/gosha/src/AllChatV2/design/penpot/milestones/04-login-window-review/${mode.replace(' ','-')}-minimum.png`});
}
await fs.writeFile('/home/gosha/src/AllChatV2/design/penpot/milestones/04-login-window-review/window-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));await browser.close();
