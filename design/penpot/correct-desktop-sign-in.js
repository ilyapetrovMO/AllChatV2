if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page required');
const b=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a6463e2cada');if(b.getPluginData('auth-native-controls'))return JSON.parse(b.getPluginData('auth-native-controls'));
const all=[];function walk(s){all.push(s);for(const c of s.children||[])walk(c)}walk(b);const texts=all.filter(s=>s.type==='text'),rects=all.filter(s=>s.type==='rectangle');
const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
for(const t of texts){if(['Username','Password'].includes(t.characters)){t.textTransform='uppercase';t.letterSpacing='0.256';}if(['127.0.0.1:4187','Sign in to your','Community','http://127.0.0.1:4187'].includes(t.characters.trim())){t.resize(384,Math.ceil(Number(t.fontSize)*1.4));t.x=b.x+484;t.align='center';}}
const bg=rects.find(s=>Math.abs(s.width-1208)<.01),card=rects.find(s=>Math.abs(s.width-480)<.01);const radius=Math.hypot(604,692)*.38;
bg.fills=[{fillColorGradient:{type:'radial',startX:.5,startY:0,endX:.5+radius/1208,endY:0,width:1208/692,stops:[{offset:0,color:'#404EED',opacity:1},{offset:1,color:'#0D0E11',opacity:1}]}}];card.name='Authentication card';card.shadows=[{style:'drop-shadow',offsetX:0,offsetY:12,blur:32,spread:0,color:{color:'#000000',opacity:.46}}];
const insideControl=s=>{let p=s.parent;while(p&&p.id!==b.id){if(p.type==='board'&&Math.abs(p.width-384)<.01)return true;p=p.parent;}return false;};
const instances=[];
for(const n of all.filter(s=>s.type==='board'&&Math.abs(s.width-384)<.01&&Math.abs(s.height-42.28)<.02)){
 n.children.find(s=>s.type==='text').characters=' ';n.name=n.y-b.y<450?'Username input':'Password input';instances.push({kind:n.name,id:n.id,componentId:penpot.library.local.components.find(c=>c.path==='Desktop / Onboarding / Address input'&&c.name==='Default').id});
}
for(const r of rects.filter(s=>Math.abs(s.width-384)<.01&&s.height<50&&!insideControl(s))){
 const input=Math.abs(r.height-42.28)<.02,kind=input?'Address input':'Button';const c=penpot.library.local.components.find(c=>c.path===`Desktop / Onboarding / ${kind}`&&c.name==='Default');
 const p=r.parent,index=p.children.findIndex(s=>s.id===r.id),x=r.x,y=r.y,n=c.instance();p.insertChild(index,n);n.x=x;n.y=y;r.remove();const label=n.children.find(s=>s.type==='text');label.characters=input?' ':'Sign in';n.name=input?(y-b.y<450?'Username input':'Password input'):'Sign in submit';instances.push({kind:n.name,id:n.id,componentId:c.id});
}
texts.find(t=>t.characters==='Sign in'&&t.y-b.y>500).remove();
const tabBackground=rects.find(s=>Math.abs(s.width-125.33)<.02&&Math.abs(s.y-b.y-328.83)<.02);tabBackground.remove();
for(let i=0;i<3;i++){
 const label=['Sign in','Register','Recovery'][i],variant=i===0?'Selected':'Idle';let c=penpot.library.local.components.find(c=>c.path==='Desktop / Authentication / Tab'&&c.name===variant);
 if(!c){const main=penpot.createBoard();main.name=variant;main.resize(125.333333,43.17);main.x=6000;main.y=1080+(variant==='Idle'?120:0);main.borderRadius=4;main.fills=variant==='Selected'?[{fillColor:'#30323A',fillOpacity:1}]:[];const t=penpot.createText('Sign in');font.applyToText(t,font.variants.find(v=>v.fontWeight==='700'&&v.fontStyle==='normal'));t.fontSize='16';t.resize(125.333333,23);t.x=main.x;t.y=main.y+11.4;t.align='center';t.fills=[{fillColor:variant==='Selected'?'#F0F1F5':'#A4A8B3',fillOpacity:1}];main.appendChild(t);c=penpot.library.local.createComponent([main]);c.name=variant;c.path='Desktop / Authentication / Tab';}
 const n=c.instance();b.appendChild(n);n.x=b.x+484+i*(125.333333+4);n.y=b.y+328.83;n.children.find(s=>s.type==='text').characters=label;n.name=`Authentication tab / ${label}`;texts.find(t=>t.characters===label&&Math.abs(t.y-b.y-340.22)<.1).remove();instances.push({kind:n.name,id:n.id,componentId:c.id});
}
b.setPluginData('auth-native-controls',JSON.stringify(instances));b.setPluginData('source-map','desktop/src/renderer/app.tsx:98 and :368; desktop/src/renderer/styles.css:241, :256 and :536');b.setPluginData('status','Desktop sign-in corrected with reusable controls and tabs; exact platform typography and state/export verification pending');return {boardId:b.id,instances};
