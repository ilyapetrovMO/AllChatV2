// Reuse the disposable design fixture started by capture.mjs --rich --serve.
import {chromium} from 'playwright';
import {capturePages} from './capture-pages.mjs';
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4187',viewport:{width:1280,height:720},locale:'en-US',timezoneId:'UTC',reducedMotion:'reduce'});
 await context.request.get('/login');
 const csrf=(await context.cookies()).find(c=>c.name==='allchat_csrf')?.value||'';
 const response=await context.request.post('/api/v1/auth/login',{data:{username:'visual-owner',password:'visual regression password'},headers:{'X-CSRF-Token':csrf}});
 if(!response.ok())throw Error('Fixture login failed '+response.status());
 await capturePages(context,new URL('./populated/',import.meta.url).pathname);
} finally {await browser.close();}
