if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page required');
const base=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a624d6665de'),font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
const specs=[{state:'address-insecure-error',top:142.75,height:462.5,value:'http://chat.example',lines:[['An Instance must use HTTPS outside local',485.06],['development',510.66]]},{state:'address-invalid-error',top:155.55,height:436.91,value:'https://',hover:true,lines:[["Failed to construct 'URL': Invalid URL",497.86]]},{state:'address-filled-after-error',top:155.55,height:436.91,value:'http://127.0.0.1:4187',hover:true,focus:true,lines:[["Failed to construct 'URL': Invalid URL",497.86]]}];const results=[];
for(let i=0;i<specs.length;i++){
 const d=specs[i],name=`Desktop / Add Instance / ${d.state}`,existing=penpot.currentPage.root.children.find(s=>s.name===name);if(existing){results.push({state:d.state,boardId:existing.id});continue;}
 const b=base.clone();b.name=name;b.x=9000;b.y=i*900;const all=[];function walk(s){all.push(s);for(const c of s.children||[])walk(c)}walk(b);
 const controls=all.filter(s=>s.type==='board'&&Math.abs(s.width-384)<.01),delta=d.top-180.34;
 const inControl=t=>{let p=t.parent;while(p&&p.id!==b.id){if(controls.some(c=>c.id===p.id))return true;p=p.parent;}return false;};
 const labels=all.filter(s=>s.type==='text'&&s.characters!=='AllChat'&&!inControl(s));for(const t of labels)t.y+=delta;
 for(let old of controls){
  old.y+=delta;const input=Math.abs(old.height-42.28)<.02;
  if((input&&d.focus)||(!input&&d.hover)){
   const kind=input?'Address input':'Button',variant=input?'Keyboard focus':'Hover',c=penpot.library.local.components.find(c=>c.path===`Desktop / Onboarding / ${kind}`&&c.name===variant);
   const p=old.parent,index=p.children.findIndex(s=>s.id===old.id),x=old.x,y=old.y,n=c.instance();p.insertChild(index,n);n.x=x;n.y=y;old.remove();old=n;
  }
  if(input){const ts=[];function texts(s){if(s.type==='text')ts.push(s);for(const c of s.children||[])texts(c)}texts(old);ts[0].characters=d.value;ts[0].fills=[{fillColor:'#F0F1F5',fillOpacity:1}];ts[0].name='Address value';}
 }
 const card=all.find(s=>s.name==='Onboarding card');card.y=b.y+d.top;card.resize(480,d.height);
 for(const [copy,y] of d.lines){const t=penpot.createText(copy);font.applyToText(t,font.variants.find(v=>v.fontWeight==='400'&&v.fontStyle==='normal'));t.fontSize='16';t.resize(384,23);t.x=b.x+484;t.y=b.y+y;t.align='center';t.fills=[{fillColor:'#A4A8B3',fillOpacity:1}];t.name='Address error';b.appendChild(t);}
 b.setPluginData('onboarding-instances','');b.setPluginData('capture',`design/penpot/populated/desktop-onboarding-reference/${d.state}.png`);b.setPluginData('status','Editable source-backed error state; platform font substitution; visual review pending');results.push({state:d.state,boardId:b.id});
}
return results;
