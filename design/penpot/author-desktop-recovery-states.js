if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page required');
const specs=[{state:'token-focused',focus:'Recovery token input'},{state:'password-focused',focus:'New password input'},{state:'submit-keyboard-focused',focus:'Replace password submit'},{state:'submit-hovered',focus:'Replace password submit',hover:true},{state:'recovery-filled',focus:'New password input'},{state:'invalid-token-error',error:true},{state:'recovery-edited-after-error',error:true,focus:'Recovery token input'}];
const base=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a647072d59b'),font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter'),results=[];
for(const [i,d] of specs.entries()){
 const name=`Desktop / Recovery / ${d.state}`,existing=penpot.currentPage.root.children.find(s=>s.name===name);if(existing){results.push({state:d.state,boardId:existing.id});continue;}
 const b=base.clone();b.name=name;b.x=18800+(i%2)*1400;b.y=Math.floor(i/2)*900;
 let controls=penpotUtils.findShapes(s=>s.type==='board'&&(s.name.endsWith(' input')||s.name.endsWith(' submit')||s.name.startsWith('Authentication tab / ')),b);
 if(controls.length!==6)throw Error('Expected six controls');
 if(d.error){const dy=-50.39;for(const t of b.children.filter(s=>s.type==='text'&&s.x-b.x>400))t.y+=dy;for(const c of controls)c.y+=dy;const card=penpotUtils.findShape(s=>s.name==='Authentication card',b);card.y=b.y+70.88;card.resize(480,606.25);}
 if(d.focus){const old=controls.find(s=>s.name===d.focus),component=penpot.library.local.components.find(c=>c.path===`Desktop / Onboarding / ${d.focus.endsWith('submit')?'Button':'Address input'}`&&c.name===(d.hover?'Hover':'Keyboard focus')),p=old.parent,index=p.children.findIndex(s=>s.id===old.id),x=old.x,y=old.y,n=component.instance();p.insertChild(index,n);n.x=x;n.y=y;n.name=d.focus;old.remove();}
 if(d.error)for(const [copy,y] of [['Error invoking remote method',531.34],["'allchat:instance:recover': Error: recovery token",556.94],['is invalid or no longer active',582.53]]){const t=penpot.createText(copy);font.applyToText(t,font.variants.find(v=>v.fontWeight==='400'&&v.fontStyle==='normal'));t.fontSize='16';t.resize(384,23);t.x=b.x+484;t.y=b.y+y;t.align='center';t.fills=[{fillColor:'#A4A8B3',fillOpacity:1}];t.name='Recovery error';b.appendChild(t);}
 b.setPluginData('capture',`design/penpot/populated/desktop-recovery-reference/${d.state}.png`);b.setPluginData('status','Editable state; visual review pending; source-captured recovery geometry');results.push({state:d.state,boardId:b.id});
}
return results;
