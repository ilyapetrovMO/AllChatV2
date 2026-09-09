import fs from 'node:fs/promises';
import {chromium} from '../../node_modules/playwright/index.mjs';
const directory=process.argv[2];if(!directory)throw Error('Provide native SVG directory');
const frames=JSON.parse(await fs.readFile(directory+'/frames.json','utf8'));
const fontSource=await fs.readFile(new URL('./milestones/03-login-prototype/login.prototype.html',import.meta.url),'utf8');
const fonts=[...fontSource.matchAll(/@font-face\s*\{[^}]+\}/g)].map(m=>m[0]).join('\n');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage({viewport:{width:1280,height:800}});
 for(const frame of frames){const svg=await fs.readFile(directory+'/'+frame.filename,'utf8');await page.setContent(`<style>${fonts}body{margin:0}</style>${svg}`);await page.evaluate(({id})=>{
  const svg=document.querySelector('svg');
  const root=[...svg.children].find(e=>e.id==='shape-'+id);
  if(!root)throw Error('Missing selected native board');
  // generateMarkup repeats descendants as top-level siblings. Keep the actual
  // board hierarchy so repeated shapes cannot bypass their ancestor clips.
  for(const child of [...svg.children])if(child.tagName.toLowerCase()==='g'&&child!==root)child.remove();
  const bounds=root.querySelector('defs > clipPath > rect');
  if(!bounds)throw Error('Missing native board bounds');
  const [x,y,w,h]=['x','y','width','height'].map(k=>Number(bounds.getAttribute(k)));
  svg.setAttribute('viewBox',`${x} ${y} ${w} ${h}`);
  svg.setAttribute('width',w);svg.setAttribute('height',h);
 },frame);await page.evaluate(()=>document.fonts.ready);frame.png=frame.filename.replace(/\.svg$/,'.png');await page.screenshot({path:directory+'/'+frame.png});}
 for(let offset=0;offset<frames.length;offset+=4){let html='<style>body{margin:0;background:#fff;font:14px sans-serif}.grid{display:grid;grid-template-columns:640px 640px}figure{margin:0}figcaption{height:24px;padding:3px 8px;box-sizing:border-box}img{width:640px;height:400px;display:block}</style><div class="grid">';for(const frame of frames.slice(offset,offset+4)){const data=(await fs.readFile(directory+'/'+frame.png)).toString('base64');html+=`<figure><figcaption>${frame.name}</figcaption><img src="data:image/png;base64,${data}"></figure>`;}html+='</div>';await page.setViewportSize({width:1280,height:848});await page.setContent(html);await page.screenshot({path:directory+'/contact-'+(offset/4+1)+'.png'});}
 await fs.writeFile(directory+'/rendered-frames.json',JSON.stringify(frames,null,2));console.log('Rendered '+frames.length+' native SVG boards and review sheets');
}finally{await browser.close();}
