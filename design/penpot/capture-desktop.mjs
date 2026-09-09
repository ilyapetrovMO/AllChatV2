import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {_electron as electron} from 'playwright';
import {captureVector} from './capture-vector.mjs';
import {captureRegistration} from './capture-desktop-registration.mjs';
import {captureRecovery} from './capture-desktop-recovery.mjs';

export async function captureDesktop(root, directory, baseURL, {messageWidgets=false,onboardingOnly=false,signInOnly=false,registrationOnly=false,recoveryOnly=false} = {}) {
  const output = path.join(directory, recoveryOnly?'desktop-recovery-reference':registrationOnly?'desktop-registration-reference':signInOnly?'desktop-sign-in-reference':onboardingOnly?'desktop-onboarding-reference':messageWidgets?'desktop-message-reference':'desktop-reference');
  await fs.mkdir(output, {recursive: true});
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'allchat-design-desktop-'));
  const executablePath = path.join(root, 'desktop/out/AllChat-linux-x64/AllChat');
  let app;
  const manifest = [];
  try {
    app = await electron.launch({executablePath, args: [`--user-data-dir=${profile}`, '--no-sandbox']});
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.setViewportSize({width:1280,height:720});
    async function capture(name) {
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({path:path.join(output,`${name}.png`),animations:'disabled',caret:'hide'});
      const visual = await captureVector(page);
      await fs.writeFile(path.join(output,`${name}.svg`),visual.svg);
      await fs.writeFile(path.join(output,`${name}.layers.json`),JSON.stringify(visual.primitives,null,2)+'\n');
      const controls = await page.locator('button,input,select,textarea,a,[role=menuitem]').evaluateAll(elements => elements.map(e=>{
        const box=e.getBoundingClientRect(),style=getComputedStyle(e);
        return {tag:e.tagName.toLowerCase(),id:e.id,className:e.className,label:e.getAttribute('aria-label')||e.textContent.trim()||e.getAttribute('placeholder')||e.labels?.[0]?.textContent.trim()||'',type:e.getAttribute('type'),disabled:Boolean(e.disabled),selected:e.getAttribute('aria-selected')||e.getAttribute('aria-current'),visible:Boolean(box.width&&box.height)&&style.visibility!=='hidden'&&style.display!=='none',inViewport:box.bottom>0&&box.right>0&&box.top<innerHeight&&box.left<innerWidth,bounds:{x:box.x,y:box.y,width:box.width,height:box.height},styles:{color:style.color,background:style.backgroundColor,fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,lineHeight:style.lineHeight,border:style.border,borderRadius:style.borderRadius,padding:style.padding,gap:style.gap,boxShadow:style.boxShadow}};
      }));
      await fs.writeFile(path.join(output,`${name}.json`),JSON.stringify({controls},null,2)+'\n');
      manifest.push({name,screenshot:`${name}.png`,controls:`${name}.json`,vector:`${name}.svg`,layers:`${name}.layers.json`,status:'captured-unreviewed'});
      await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify({platform:'Electron Linux; OS differences still require verification',viewport:{width:1280,height:720},items:manifest},null,2)+'\n');
    }
    await page.getByLabel('Community address').waitFor();
    await page.mouse.move(1100,650);
    await capture('add-instance');
    if(onboardingOnly){
      const address=page.getByLabel('Community address');
      const submit=page.getByRole('button',{name:'Add Instance',exact:true});
      await address.focus();await capture('address-focused');
      await page.keyboard.press('Tab');await capture('submit-keyboard-focused');
      await submit.evaluate(e=>e.blur());await submit.hover();await capture('submit-hovered');
      await address.hover();await capture('address-hovered');
      await submit.click();
      const validation=await address.evaluate(e=>({valid:e.validity.valid,valueMissing:e.validity.valueMissing,message:e.validationMessage}));
      if(!validation.valueMissing)throw new Error('Expected native required-field validation');
      await capture('address-required');
      await fs.writeFile(path.join(output,'native-validation.json'),JSON.stringify(validation,null,2)+'\n');
      await address.fill('http://chat.example');await submit.click();
      await page.getByRole('alert').filter({hasText:'An Instance must use HTTPS outside local development'}).waitFor();
      await capture('address-insecure-error');
      await address.fill('https://');await submit.click();
      await page.getByRole('alert').filter({hasText:'Invalid URL'}).waitFor();
      await capture('address-invalid-error');
      await address.fill(baseURL);await capture('address-filled-after-error');
      await submit.click();await page.getByLabel('Username').waitFor();
      await capture('add-instance-success-sign-in');
      await page.getByRole('button',{name:'Add Community',exact:true}).click();
      await page.getByRole('heading',{name:'Add a Community',exact:true}).waitFor();
      await page.mouse.move(1100,650);await capture('add-another-community');
      console.log(`Captured ${manifest.length} Add Instance states.`);
      return;
    }
    await page.getByLabel('Community address').fill(baseURL);
    await page.getByRole('button',{name:'Add Instance',exact:true}).click();
    await page.getByLabel('Username').waitFor();
    await page.mouse.move(1100,650);
    await capture('sign-in');
    if(recoveryOnly){await captureRecovery(page,capture,output,baseURL);return;}
    if(registrationOnly){await captureRegistration(page,capture,output,baseURL);return;}
    if(signInOnly){
      const username=page.getByLabel('Username'),password=page.getByLabel('Password');
      const submit=page.locator('form').getByRole('button',{name:'Sign in',exact:true});
      await username.focus();await capture('username-focused');
      await password.focus();await capture('password-focused');
      await page.keyboard.press('Tab');await capture('submit-keyboard-focused');
      await submit.evaluate(e=>e.blur());await submit.hover();await capture('submit-hovered');
      await page.getByRole('navigation',{name:'Authentication'}).getByRole('button',{name:'Register',exact:true}).hover();await capture('register-tab-hovered');
      const native=[];
      await submit.click();native.push(await username.evaluate(e=>({field:'username',valueMissing:e.validity.valueMissing,message:e.validationMessage})));
      if(!native[0].valueMissing)throw Error('Username validation did not trigger');
      await capture('username-required');
      await username.fill('visual-owner');await submit.click();native.push(await password.evaluate(e=>({field:'password',valueMissing:e.validity.valueMissing,message:e.validationMessage})));
      if(!native[1].valueMissing)throw Error('Password validation did not trigger');
      await capture('password-required');
      await fs.writeFile(path.join(output,'native-validation.json'),JSON.stringify(native,null,2)+'\n');
      await username.fill('catalog-no-such-member');await password.fill('catalog invalid password');await page.mouse.move(1100,650);await capture('credentials-filled');
      await submit.click();await page.getByRole('alert').waitFor();await capture('login-error');
      await fs.writeFile(path.join(output,'login-error-copy.json'),JSON.stringify({copy:await page.getByRole('alert').textContent()},null,2)+'\n');
      await username.fill('visual-owner');await password.fill('visual regression password');await capture('credentials-edited-after-error');
      await submit.click();await page.locator('.welcome').waitFor();await capture('login-success-home');
      console.log(`Captured ${manifest.length} sign-in flow references.`);return;
    }
    for(const [label,name] of [['Register','register'],['Recovery','account-recovery']]) {
      await page.getByRole('navigation',{name:'Authentication'}).getByRole('button',{name:label,exact:true}).click();
      await capture(name);
    }
    await page.getByRole('navigation',{name:'Authentication'}).getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByLabel('Username').fill('visual-owner');
    await page.getByLabel('Password').fill('visual regression password');
    await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();
    await page.locator('.welcome').waitFor();
    await capture('community-home');
    await page.getByRole('button',{name:'general',exact:true}).click();
    await page.locator('.message').first().waitFor();
    await capture('text-channel');
    if(messageWidgets){
      await page.locator('.attachment-image-button').first().click();
      await page.getByRole('dialog').waitFor();await capture('image-viewer-default');
      await page.getByRole('dialog').hover();await page.mouse.wheel(0,-100);await capture('image-viewer-zoomed');
      await page.getByRole('button',{name:'Close image viewer'}).click();
      await page.locator('.message').first().hover();
      await page.locator('[data-reaction-trigger]').first().click();
      await page.getByRole('menu',{name:'Choose a Reaction'}).waitFor();await capture('reaction-picker-empty');
      await page.getByRole('textbox',{name:'Custom Reaction'}).fill('✨');await capture('reaction-picker-custom');
      await page.keyboard.press('Escape');
      await page.locator('input[type=file]').first().setInputFiles({name:'catalog-example.txt',mimeType:'text/plain',buffer:Buffer.from('Disposable design fixture attachment.')});
      await page.getByRole('region',{name:'Files ready to send'}).waitFor();await capture('pending-file');
      await page.getByRole('button',{name:'Remove catalog-example.txt'}).click();
      console.log('Captured desktop message widget states.');return;
    }

    await page.getByRole('button',{name:'Open Member menu',exact:true}).click();
    await page.getByRole('menu',{name:'Presence status'}).waitFor();
    await capture('member-presence-menu');
    await page.getByRole('button',{name:'Open Member menu',exact:true}).click();
    await page.locator('.community-header').click();
    await capture('community-menu');
    await page.locator('.community-header').click();
    await page.getByRole('button',{name:'Notifications',exact:true}).click();
    await page.locator('.notification-popover').waitFor();
    await capture('conversation-notification-menu');
    await page.getByRole('button',{name:'Notifications',exact:true}).click();

    await page.getByRole('button',{name:'User Settings',exact:true}).click();
    const settings=page.getByRole('navigation',{name:'User settings',exact:true});
    await settings.waitFor();
    for(const label of ['My Account','Voice & Video','Ringtone','Notifications','Sessions','Safety']) {
      await settings.getByRole('button',{name:label,exact:true}).click();
      const name=`settings-${label.toLowerCase().replaceAll(/[^a-z]+/g,'-')}`;
      const panel=page.locator('.settings-layout');
      await panel.evaluate(e=>{e.scrollTop=0;});
      await capture(name);
      const steps=await panel.evaluate(e=>Math.ceil((e.scrollHeight-e.clientHeight)/Math.max(1,e.clientHeight*0.8)));
      for(let step=1;step<=steps;step++){await panel.evaluate((e,n)=>{e.scrollTop=n*e.clientHeight*0.8;},step);await capture(`${name}-scroll-${step}`);}

    }
    await settings.getByRole('button',{name:'Back to Community',exact:true}).click();
    await page.locator('.community-header').click();
    await page.getByRole('menuitem',{name:'Community Settings',exact:true}).click();
    const admin=page.getByRole('navigation',{name:'Community settings',exact:true});
    await admin.waitFor();
    for(const label of ['General','Dashboard','Channels','Roles','Invitations','Soundboard']) {
      await admin.getByRole('button',{name:label,exact:true}).click();
      if(label==='Dashboard')await page.locator('.dashboard-stat').first().waitFor();
      await page.locator('.community-settings-layout').evaluate(e=>{e.scrollTop=0;});
      await capture(`admin-${label.toLowerCase()}`);
    }
    console.log(`Captured ${manifest.length} desktop states.`);
  } finally {
    await app?.close();
    await fs.rm(profile,{recursive:true,force:true});
  }
}
