if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page required');
const base=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a624d6665de');
const specs=[['address-focused','Address input','Keyboard focus',42.28],['submit-keyboard-focused','Button','Keyboard focus',43.17],['submit-hovered','Button','Hover',43.17],['address-hovered','Address input','Hover',42.28]];const results=[];
for(let i=0;i<specs.length;i++){
 const [state,kind,variant,height]=specs[i],name=`Desktop / Add Instance / ${state}`;
 const existing=penpot.currentPage.root.children.find(s=>s.name===name);if(existing){results.push({state,boardId:existing.id,existing:true});continue;}
 const component=penpot.library.local.components.find(c=>c.path===`Desktop / Onboarding / ${kind}`&&c.name===variant);if(!component)throw Error('Missing '+kind+' '+variant);
 const b=base.clone();b.name=name;b.x=7600;b.y=i*900;
 const candidates=[];function walk(s){if(s.type==='board'&&Math.abs(s.width-384)<.01&&Math.abs(s.height-height)<.02)candidates.push(s);for(const c of s.children||[])walk(c)}walk(b);
 if(candidates.length!==1)throw Error('Expected one target control');
 const old=candidates[0],parent=old.parent,index=parent.children.findIndex(s=>s.id===old.id),x=old.x,y=old.y;
 const instance=component.instance();parent.insertChild(index,instance);instance.x=x;instance.y=y;old.remove();
 b.setPluginData('onboarding-instances','');b.setPluginData('capture',`design/penpot/populated/desktop-onboarding-reference/${state}.png`);b.setPluginData('status','Editable screen state with reusable control; Inter substitution; visual verification pending');
 results.push({state,boardId:b.id,componentId:component.id,instanceId:instance.id});
}
return results;
