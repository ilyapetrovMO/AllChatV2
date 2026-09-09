import fs from 'node:fs/promises';
import {chromium} from '../../node_modules/playwright/index.mjs';
const css=await fs.readFile('desktop/src/renderer/styles.css','utf8');
const rules=['.camera-test {','.camera-test video {'].map(prefix=>css.slice(css.indexOf(prefix),css.indexOf('}',css.indexOf(prefix))+1)).join('\n');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{const page=await browser.newPage();await page.setContent(`<style>${rules}</style><div class="camera-test" style="width:854px"><video autoplay muted playsinline></video></div>`);const results=[];
for(const [width,height] of [[1280,720],[360,640]]){results.push(await page.evaluate(async({width,height})=>{const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').fillRect(0,0,width,height);const stream=c.captureStream(5),v=document.querySelector('video');v.srcObject=stream;await v.play();const vr=v.getBoundingClientRect(),pr=v.parentElement.getBoundingClientRect(),scale=Math.min(vr.width/width,vr.height/height);const result={input:{width,height},video:{width:vr.width,height:vr.height},preview:{width:pr.width,height:pr.height},containedFrame:{width:width*scale,height:height*scale},objectFit:getComputedStyle(v).objectFit};stream.getTracks().forEach(t=>t.stop());return result;},{width,height}));}
await fs.writeFile('design/penpot/milestones/29-camera-preview/layout-measurements.json',JSON.stringify({rules,results},null,2));console.log(JSON.stringify(results));}finally{await browser.close();}
