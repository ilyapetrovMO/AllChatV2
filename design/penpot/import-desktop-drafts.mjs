import {Client} from '../../.dev/penpot-mcp/packages/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StreamableHTTPClientTransport} from '../../.dev/penpot-mcp/packages/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import readline from 'node:readline/promises';
const input=readline.createInterface({input:process.stdin,output:process.stdout,terminal:false});
const {readFileSync}=await import('node:fs');
const {homedir}=await import('node:os');
const config=readFileSync((process.env.CODEX_HOME || homedir()+'/.codex')+'/config.toml','utf8');
const section=config.match(/^\[mcp_servers\.penpot\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
const url=section?.match(/^url\s*=\s*"([^"\n]+)"/m)?.[1];
if(!url) {console.log('No Penpot URL found in this environment configuration.');process.exit(1);}
const client=new Client({name:'allchat-design-trial',version:'1.0.0'});
const {writeFileSync}=await import('node:fs');
const directory=new URL('.',import.meta.url);
const platform=process.argv[2]||'desktop';
if(!['web','desktop','sketchboard','desktop-message'].includes(platform))throw Error('Use web or desktop');
const title=platform==='desktop-message'?'Desktop widgets':platform==='web'?'Web':platform==='sketchboard'?'Sketchboard':'Desktop';
const pageName=platform==='web'?'01 — Web':platform==='sketchboard'?'05 — Sketchboard':'02 — Desktop';
const drafts=JSON.parse(readFileSync(new URL(`${platform}-native-drafts.json`,directory),'utf8'));
const progressPath=new URL(`${platform}-native-progress.json`,directory);
let progress=[];try{progress=JSON.parse(readFileSync(progressPath,'utf8'));}catch{}
async function run(code){
 const r=await client.callTool({name:'execute_code',arguments:{code}},undefined,{timeout:60000});
 if(r.isError)throw Error('Penpot tool failed');
 const t=r.content?.find(p=>p.type==='text')?.text||'';
 if(t.startsWith('Tool execution failed:'))throw Error(t.slice(0,500));
 return JSON.parse(t).result;
}
try {
 await client.connect(new StreamableHTTPClientTransport(new URL(url)),{timeout:20000});
 const target=await run("return {file:penpot.currentFile.id,page:penpot.currentPage.name};");
 if(target.file!=='c828d3cf-7d4e-8145-8008-9a4f1a6ff37f'||target.page!==pageName)throw Error(`Open the ${title} catalog page first`);
 for(const [index,draft] of drafts.entries()){
  const name=platform==='desktop'&&index===0?'Desktop / Add Instance / Draft':`${title} / ${draft.displayName||draft.name} / Draft`;
  const existing=await run(`return penpot.currentPage.root.children.find(s=>s.name===${JSON.stringify(name)})?.id||null;`);
  if(existing){
   const previous=progress.find(p=>p.boardId===existing);
   if(previous?.status.startsWith('incomplete:')){
    await run(`const s=penpot.currentPage.root.children.find(s=>s.id===${JSON.stringify(existing)});if(s)s.remove();return true;`);
    progress=progress.filter(p=>p.boardId!==existing);
    writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
   }else{console.log('Already present: '+draft.name);continue;}
  }
  const slot=platform==='web'?await run("return penpot.currentPage.root.children.filter(s=>s.name.startsWith('Web /')).length;"):index;
  const data=JSON.stringify(draft);
  await run('storage.desktopDraftChunks=[];return true;');
  for(let offset=0,n=0;offset<data.length;offset+=35000,n++)await run(`storage.desktopDraftChunks[${n}]=${JSON.stringify(data.slice(offset,offset+35000))};return true;`);
  const result=await run(`
   if(penpot.currentPage.name!==${JSON.stringify(pageName)})throw Error('Target page changed');
   const d=JSON.parse(storage.desktopDraftChunks.join(''));
   if(d.texts.some(t=>t.text&&!Number.isFinite(parseFloat(t['font-size']))))throw Error('Missing captured font size; regenerate before importing');
   const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');if(!font)throw Error('Inter unavailable');
   const x=${1400+(slot%3)*1400},y=${(platform==='desktop-message'?9000:0)+Math.floor(slot/3)*Math.max(900,...drafts.map(d=>(d.height||720)+180))};
   const board=penpot.createBoard();board.name=${JSON.stringify(name)};board.resize(d.width||1280,d.height||720);board.x=x;board.y=y;
   const base=penpot.createShapeFromSvg(d.svg);board.appendChild(base);base.x=x;base.y=y;base.name='Captured vector layout — review pending';
   const markers=new Map();function indexMarkers(s){if(s.type==='rectangle'&&s.width===1&&s.height===1){const c=s.fills?.[0]?.fillColor?.toLowerCase();if(c?.startsWith('#fe'))markers.set(c,s);}for(const c of s.children||[])indexMarkers(c);}indexMarkers(base);
   for(const data of d.texts){
    const marker=data.marker?markers.get(data.marker):null;if(data.marker&&!marker)throw Error('Missing native text marker');
    if(!data.text){marker?.remove();continue;}
    const t=penpot.createText(data.text);const variant=font.variants.find(v=>v.fontWeight===data['font-weight']&&v.fontStyle==='normal');font.applyToText(t,variant);
    t.name=data.text.trim().replaceAll('/', '∕').slice(0,60)||'Text';t.fontSize=String(parseFloat(data['font-size']));t.growType='auto-width';
    const rgb=data.fill.match(/[\\d.]+/g);t.fills=[{fillColor:rgb?'#'+rgb.slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join('').toUpperCase():data.fill,fillOpacity:1}];
    if(marker){const parent=marker.parent;parent.insertChild(parent.children.findIndex(s=>s.id===marker.id),t);marker.remove();}else board.appendChild(t);t.x=x+Number(data.x);t.y=y+Number(data.y)-parseFloat(data['font-size']);
   }
   for(const img of d.images||[]){
    const href=img.href||img['{http://www.w3.org/1999/xlink}href'];
    const match=href?.match(/^data:([^;]+);base64,(.*)$/);if(!match)throw Error('Unsupported image reference');
    let target;function findImage(s){if(s.type==='rectangle'&&s.fills?.[0]?.fillColor?.toLowerCase()===img.marker)target=s;for(const c of s.children||[])findImage(c);}findImage(base);if(!target)throw Error('Image marker missing');
    const media=await penpot.uploadMediaData('Captured image asset',Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0)),match[1]);target.name='Captured image asset';target.fills=[{fillImage:media,fillOpacity:1}];
   }
   board.setPluginData('capture',d.reference);board.setPluginData('status',d.status);
   return {boardId:board.id,nativeTextLayers:d.texts.filter(t=>t.text).length};
  `);
  progress.push({name:draft.name,...result,status:'native draft; visual verification pending'});
  writeFileSync(progressPath,JSON.stringify(progress,null,2)+'\n');
  console.log('Created: '+draft.name+' ('+result.nativeTextLayers+' text layers)');
 }
} catch(error){console.log('Import stopped: '+String(error.message).replaceAll(url,'[REDACTED]'));process.exitCode=1;}
finally{await client.close();input.close();}
