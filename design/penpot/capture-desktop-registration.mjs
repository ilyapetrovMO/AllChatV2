import fs from 'node:fs/promises';
import path from 'node:path';
import {request} from 'playwright';

export async function captureRegistration(page,capture,output,baseURL){
 const url=new URL(baseURL);if(url.hostname!=='127.0.0.1'||url.port!=='4187')throw Error('Registration capture requires the disposable local fixture');
 await page.getByRole('navigation',{name:'Authentication'}).getByRole('button',{name:'Register',exact:true}).click();await page.mouse.move(1100,700);await capture('register');
 const invitation=page.getByLabel('Invitation token'),username=page.getByLabel('Username'),password=page.getByLabel('Password'),submit=page.locator('form').getByRole('button',{name:'Create Account',exact:true});
 for(const [field,name] of [[invitation,'invitation-focused'],[username,'username-focused'],[password,'password-focused']]){await field.focus();await capture(name);}
 await page.keyboard.press('Tab');await capture('submit-keyboard-focused');await submit.evaluate(e=>e.blur());await submit.hover();await capture('submit-hovered');
 const validation=[];
 for(const [field,name,value] of [[invitation,'invitation-required','catalog-invalid-invitation'],[username,'username-required','catalog-registration'],[password,'password-required','short']]){
  await submit.click();const v=await field.evaluate(e=>({valueMissing:e.validity.valueMissing,message:e.validationMessage}));if(!v.valueMissing)throw Error('Expected required validation '+name);validation.push({state:name,...v});await capture(name);await field.fill(value);
 }
 await submit.click();const short=await password.evaluate(e=>({tooShort:e.validity.tooShort,minLength:e.minLength,message:e.validationMessage}));if(!short.tooShort)throw Error('Expected short password validation');validation.push({state:'password-too-short',...short});await capture('password-too-short');
 await password.fill('catalog registration password');await page.mouse.move(1100,700);await capture('registration-filled');await submit.click();await page.getByRole('alert').waitFor();await capture('invalid-invitation-error');
 await fs.writeFile(path.join(output,'validation.json'),JSON.stringify(validation,null,2)+'\n');await fs.writeFile(path.join(output,'error-copy.json'),JSON.stringify({copy:await page.getByRole('alert').textContent()},null,2)+'\n');
 const api=await request.newContext({baseURL});
 try{
  await api.get('/login');let csrf=(await api.storageState()).cookies.find(c=>c.name==='allchat_csrf')?.value||'';
  const login=await api.post('/api/v1/auth/login',{data:{username:'visual-owner',password:'visual regression password'},headers:{'X-CSRF-Token':csrf}});if(!login.ok())throw Error('Fixture owner login failed '+login.status());
  csrf=(await api.storageState()).cookies.find(c=>c.name==='allchat_csrf')?.value||'';
  const response=await api.post('/api/v1/invitations',{data:{expires_in_minutes:60,max_uses:1},headers:{'X-CSRF-Token':csrf}});if(!response.ok())throw Error('Fixture invitation creation failed '+response.status());const data=await response.json();
  await invitation.fill(data.token);await username.fill('catalog-reg-'+Date.now());await capture('registration-edited-after-error');await submit.click();await page.locator('.welcome').waitFor();await capture('registration-success-home');
 }finally{await api.dispose();}
 console.log('Captured registration interactions, native validation, invalid invitation and successful local registration.');
}
