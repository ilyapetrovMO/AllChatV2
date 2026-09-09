import fs from 'node:fs/promises';
import {chromium} from '../../node_modules/playwright/index.mjs';
const directory=process.argv[2];if(!directory)throw Error('Provide native SVG directory');
const frames=JSON.parse(await fs.readFile(directory+'/frames.json','utf8'));
const fontSource=await fs.readFile(new URL('./milestones/03-login-prototype/login.prototype.html',import.meta.url),'utf8');
const fonts=[...fontSource.matchAll(/@font-face\s*\{[^}]+\}/g)].map(m=>m[0]).join('\n');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage({viewport:{width:1280,height:800}});
 for(const frame of frames){const svg=await fs.readFile(directory+'/'+frame.filename,'utf8');await page.setContent(`<style>${fonts}body{margin:0}</style>${svg}`);await page.evaluate(()=>document.fonts.ready);frame.png=frame.filename.replace(/\.svg$/,'.png');await page.screenshot({path:directory+'/'+frame.png});}
 for(let offset=0;offset<frames.length;offset+=4){let html='<style>body{margin:0;background:#fff;font:14px sans-serif}.grid{display:grid;grid-template-columns:640px 640px}figure{margin:0}figcaption{height:24px;padding:3px 8px;box-sizing:border-box}img{width:640px;height:400px;display:block}</style><div class="grid">';for(const frame of frames.slice(offset,offset+4)){const data=(await fs.readFile(directory+'/'+frame.png)).toString('base64');html+=`<figure><figcaption>${frame.name}</figcaption><img src="data:image/png;base64,${data}"></figure>`;}html+='</div>';await page.setViewportSize({width:1280,height:848});await page.setContent(html);await page.screenshot({path:directory+'/contact-'+(offset/4+1)+'.png'});}
 await fs.writeFile(directory+'/rendered-frames.json',JSON.stringify(frames,null,2));console.log('Rendered '+frames.length+' native SVG boards and review sheets');
}finally{await browser.close();}
