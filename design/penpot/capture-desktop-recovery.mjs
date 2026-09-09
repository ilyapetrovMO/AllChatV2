import fs from 'node:fs/promises';
import path from 'node:path';
import {request} from 'playwright';

export async function captureRecovery(page,capture,output,baseURL){
 const url=new URL(baseURL);if(url.hostname!=='127.0.0.1'||url.port!=='4187')throw Error('Recovery capture requires the disposable local fixture');
 await page.getByRole('navigation',{name:'Authentication'}).getByRole('button',{name:'Recovery',exact:true}).click();await page.mouse.move(1100,700);await capture('account-recovery');
 const token=page.getByLabel('Recovery token'),password=page.getByLabel('New password'),submit=page.locator('form').getByRole('button',{name:'Replace password',exact:true});
 for(const [field,name] of [[token,'token-focused'],[password,'password-focused']]){await field.focus();await capture(name);}
 await page.keyboard.press('Tab');await capture('submit-keyboard-focused');await submit.evaluate(e=>e.blur());await submit.hover();await capture('submit-hovered');
 const validation=[];
 for(const [field,name,value] of [[token,'token-required','catalog-invalid-recovery-token'],[password,'password-required','short']]){
  await submit.click();const v=await field.evaluate(e=>({valueMissing:e.validity.valueMissing,message:e.validationMessage}));if(!v.valueMissing)throw Error('Expected required validation '+name);validation.push({state:name,...v});await capture(name);await field.fill(value);
 }
 await submit.click();const v=await password.evaluate(e=>({tooShort:e.validity.tooShort,minLength:e.minLength,message:e.validationMessage}));if(!v.tooShort)throw Error('Expected short password validation');validation.push({state:'password-too-short',...v});await capture('password-too-short');
 await password.fill('catalog replacement password');await page.mouse.move(1100,700);await capture('recovery-filled');await submit.click();await page.getByRole('alert').waitFor();await capture('invalid-token-error');
 const error=await page.getByRole('alert').textContent();await token.fill('catalog-edited-invalid-token');await capture('recovery-edited-after-error');if(await page.getByRole('alert').textContent()!==error)throw Error('Expected alert retained while editing');
 await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(validation,null,2)+'\n');await fs.writeFile(path.join(output,'error-copy.json'),JSON.stringify({copy:error},null,2)+'\n');
 const owner=await request.newContext({baseURL}),memberContext=await request.newContext({baseURL});
 try{
  async function post(ctx,url,data){const csrf=(await ctx.storageState()).cookies.find(c=>c.name==='allchat_csrf')?.value||'';const r=await ctx.post(url,{data,headers:{'X-CSRF-Token':csrf}});if(!r.ok())throw Error('Fixture request failed '+url+' '+r.status());return r.json();}
  await owner.get('/login');await post(owner,'/api/v1/auth/login',{username:'visual-owner',password:'visual regression password'});
  const invitation=await post(owner,'/api/v1/invitations',{expires_in_minutes:60,max_uses:1});
  const username='catalog-recover-'+Date.now();
  const member=await post(memberContext,'/api/v1/auth/register',{token:invitation.token,username,password:'catalog initial password'});
  const recovery=await post(owner,'/api/v1/admin/members/'+member.id+'/recovery-token',{});
  await token.fill(recovery.token);await password.fill('catalog replacement password');await capture('valid-token-filled');await submit.click();
  await page.getByRole('heading',{name:'Sign in to your Community',exact:true}).waitFor();
  const success='Password replaced. Sign in with your new password.';await page.getByRole('alert').filter({hasText:success}).waitFor();await capture('recovery-success-sign-in');
  await page.getByLabel('Username').fill(username);await page.getByLabel('Password').fill('catalog replacement password');await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('.welcome').waitFor();await capture('recovered-member-home');
  await fs.writeFile(path.join(output,'success.json'),JSON.stringify({confirmation:success,replacementLoginVerified:true,member:'dedicated disposable recovery member'},null,2)+'\n');
 }finally{await owner.dispose();await memberContext.dispose();}
}
