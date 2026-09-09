if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page required');
const specs=[{state:'registration-filled',focus:'Password input'},{state:'invalid-invitation-error',error:true},{state:'registration-edited-after-error',error:true,focus:'Password input'}];
const base=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a646a6de6ad'),font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter'),results=[];
for(const [i,d] of specs.entries()){
 const name=`Desktop / Registration / ${d.state}`,existing=penpot.currentPage.root.children.find(s=>s.name===name);if(existing){results.push({state:d.state,boardId:existing.id});continue;}
 const b=base.clone();b.name=name;b.x=13200+((i+5)%2)*1400;b.y=Math.floor((i+5)/2)*900;
 let controls=penpotUtils.findShapes(s=>s.type==='board'&&(s.name.endsWith(' input')||s.name.endsWith(' submit')||s.name.startsWith('Authentication tab / ')),b);
 if(controls.length!==7)throw Error('Expected seven controls');
 if(d.error){const dy=-27.97;for(const t of b.children.filter(s=>s.type==='text'&&s.x-b.x>400))t.y+=dy;for(const c of controls)c.y+=dy;const card=penpotUtils.findShape(s=>s.name==='Authentication card',b);card.y=b.y+52;card.resize(480,688.83);}
 if(d.focus){const old=controls.find(s=>s.name===d.focus),component=penpot.library.local.components.find(c=>c.path==='Desktop / Onboarding / Address input'&&c.name==='Keyboard focus'),p=old.parent,index=p.children.findIndex(s=>s.id===old.id),x=old.x,y=old.y,n=component.instance();p.insertChild(index,n);n.x=x;n.y=y;n.name=d.focus;old.remove();}
 if(d.error)for(const [copy,y] of [['Error invoking remote method',595.05],["'allchat:instance:register': Error: Invitation is",620.64],['invalid or no longer active',646.23]]){const t=penpot.createText(copy);font.applyToText(t,font.variants.find(v=>v.fontWeight==='400'&&v.fontStyle==='normal'));t.fontSize='16';t.resize(384,23);t.x=b.x+484;t.y=b.y+y;t.align='center';t.fills=[{fillColor:'#A4A8B3',fillOpacity:1}];t.name='Registration error';b.appendChild(t);}
 b.setPluginData('capture',`design/penpot/populated/desktop-registration-reference/${d.state}.png`);b.setPluginData('status','Editable state; visual review pending; error card intentionally extends below viewport as captured');results.push({state:d.state,boardId:b.id});
}
return results;
