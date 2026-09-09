import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const directory=path.dirname(fileURLToPath(import.meta.url));
let css=await fs.readFile(path.join(directory,'fonts/inter.css'),'utf8');
for(const name of new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1]))){
  const data=await fs.readFile(path.join(directory,'fonts',name));
  css=css.replaceAll(name,`data:font/ttf;base64,${data.toString('base64')}`);
}
const input=process.argv[2]||path.join(directory,'desktop-add-instance-live.svg');
const output=process.argv[3]||path.join(directory,'desktop-add-instance-local-render.png');
const raw=await fs.readFile(input,'utf8');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.setContent(`<style>body{margin:0}${css}</style>${raw}`);
  // generateMarkup repeats descendants after the full board, obscuring its text.
  // Preserve the raw output; render only the original board subtree.
  await page.evaluate(()=>{
    const svg=document.querySelector('svg');
    const board=[...svg.children].find(child=>child.tagName.toLowerCase()==='g');
    if(!board?.querySelector('.frame-background'))throw Error('Expected board subtree');
    for(const child of [...svg.children]){
      if(child.tagName.toLowerCase()==='g'&&child!==board)child.remove();
    }
    const frame=board.querySelector('.frame-background');
    svg.setAttribute('height','720');svg.setAttribute('viewBox',`${frame.getAttribute('x')} ${frame.getAttribute('y')} 1280 720`);
  });
  await page.evaluate(async()=>{
    await Promise.all([400,700,800].map(w=>document.fonts.load(`${w} 16px Inter`)));
    await document.fonts.ready;
    if(![400,700,800].every(w=>document.fonts.check(`${w} 16px Inter`)))throw Error('Inter failed to load');
  });
  await page.screenshot({path:output});
  console.log('Rendered desktop board subtree with Inter 400/700/800; hosted export remains a separate check.');
}finally{await browser.close();}
