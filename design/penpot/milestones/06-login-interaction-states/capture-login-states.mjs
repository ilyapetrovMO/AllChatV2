import fs from 'node:fs/promises';import {chromium} from '/home/gosha/src/AllChatV2/node_modules/playwright/index.mjs';
const out='/home/gosha/src/AllChatV2/design/penpot/milestones/06-login-interaction-states';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:1280,height:1100}});const result=[];
try{await p.goto('file:///tmp/allchat-login-interactive/desktop/prototypes/login.prototype.html');await p.evaluate(()=>document.fonts.ready);
for(const [name,selector,action] of [['username-focus','input[name=username]','focus'],['password-focus','input[name=password]','focus'],['register-hover','button[data-mode=register]','hover'],['submit-hover','form button[type=submit]','hover']]){
await p.evaluate(()=>document.activeElement.blur());await p.mouse.move(1279,1099);await p.locator(selector)[action]();await p.waitForTimeout(250);
result.push(await p.locator(selector).evaluate((e,name)=>{const c=getComputedStyle(e),r=e.getBoundingClientRect(),v=document.querySelector('#viewport').getBoundingClientRect();return {name,background:c.backgroundColor,color:c.color,border:c.border,outline:c.outline,shadow:c.boxShadow,borderRadius:c.borderRadius,x:r.x-v.x,y:r.y-v.y,width:r.width,height:r.height}},name));await p.locator('#viewport').screenshot({path:`${out}/${name}.png`});}
await fs.writeFile(`${out}/computed-styles.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{await browser.close()}
