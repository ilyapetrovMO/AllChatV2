import fs from 'node:fs/promises';
import {chromium} from '/home/gosha/src/AllChatV2/node_modules/playwright/index.mjs';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:960}});
const results=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
const check=(name,value)=>{if(!value)throw Error(name);results.push(name);};
const submit=()=>page.locator('form button[type=submit]').click();
try{
 await page.goto('file:///tmp/allchat-login-interactive/desktop/prototypes/login.prototype.html');await page.evaluate(()=>document.fonts.ready);
 await page.locator('#viewport').screenshot({path:'/home/gosha/src/AllChatV2/design/penpot/milestones/03-login-prototype/browser-default.png'});
 await submit();check('Empty username blocked by native validation',await page.getByLabel('Username',{exact:true}).evaluate(e=>e.validity.valueMissing));
 await page.getByLabel('Username',{exact:true}).fill('visual-owner');await submit();check('Empty password blocked by native validation',await page.getByLabel('Password',{exact:true}).evaluate(e=>e.validity.valueMissing));
 await page.getByRole('button',{name:'Use invalid values',exact:true}).click();await submit();check('Invalid credentials display login error',(await page.getByRole('alert').textContent()).includes('invalid username or password'));
 await page.getByLabel('Password',{exact:true}).fill('visual regression password');check('Editing retains error',(await page.getByRole('alert').textContent()).includes('invalid username or password'));
 await page.locator('#viewport').screenshot({path:'/home/gosha/src/AllChatV2/design/penpot/milestones/03-login-prototype/browser-retry.png'});
 await submit();check('Retry reaches signed-in preview',await page.getByRole('heading',{name:'Signed in to your Community'}).count()===1);
 await page.getByRole('button',{name:'Restart',exact:true}).click();check('Restart returns to empty sign-in',await page.getByLabel('Username',{exact:true}).inputValue()==='');
 await page.getByRole('button',{name:'Register',exact:true}).click();check('Register tab navigates',await page.getByRole('heading',{name:'Join your Community'}).count()===1);
 await page.getByRole('button',{name:'Fill demo values',exact:true}).click();await submit();check('Demo registration signs in',await page.getByRole('heading',{name:'Signed in to your Community'}).count()===1);
 await page.getByRole('button',{name:'Restart',exact:true}).click();await page.getByRole('button',{name:'Recovery',exact:true}).click();
 await page.getByRole('button',{name:'Use invalid values',exact:true}).click();await submit();check('Invalid recovery token shows error',(await page.getByRole('alert').textContent()).includes('recovery token is invalid'));
 await page.getByRole('button',{name:'Fill demo values',exact:true}).click();await page.getByLabel('New password').fill('short');await submit();check('Recovery rejects short passwords',await page.getByLabel('New password').evaluate(e=>e.validity.tooShort));
 await page.getByLabel('New password').fill('catalog replacement password');await submit();check('Recovery returns to sign-in with confirmation',(await page.getByRole('alert').textContent()).includes('Password replaced'));
 await page.getByRole('button',{name:'Fill demo values',exact:true}).click();await submit();check('Replacement password signs in',await page.getByRole('heading',{name:'Signed in to your Community'}).count()===1);
 await page.getByRole('button',{name:'Restart',exact:true}).click();await page.getByLabel('Username',{exact:true}).focus();await page.keyboard.press('Tab');check('Keyboard moves from username to password',await page.getByLabel('Password',{exact:true}).evaluate(e=>e===document.activeElement));
 await page.keyboard.press('Tab');check('Keyboard reaches submit',await page.locator('form button[type=submit]').evaluate(e=>e===document.activeElement));
 check('No JavaScript errors',errors.length===0);
 await fs.writeFile('/home/gosha/src/AllChatV2/design/penpot/milestones/03-login-prototype/browser-checks.json',JSON.stringify({passed:results,errors},null,2)+'\n');console.log(JSON.stringify({passed:results.length,results}));
}finally{await browser.close();}
