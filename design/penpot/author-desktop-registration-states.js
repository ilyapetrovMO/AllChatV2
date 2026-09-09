if(penpot.currentPage.id!=='6bdc1c40-ce96-804f-8008-9a5f830fd73b')throw Error('Desktop page required');
const base=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a646a6de6ad');
const specs=[['invitation-focused','Invitation token input','Keyboard focus'],['username-focused','Username input','Keyboard focus'],['password-focused','Password input','Keyboard focus'],['submit-keyboard-focused','Create Account submit','Keyboard focus'],['submit-hovered','Create Account submit','Hover']];
const results=[];
for(const [i,[state,target,variant]] of specs.entries()){
 const name=`Desktop / Registration / ${state}`,existing=penpot.currentPage.root.children.find(s=>s.name===name);
 if(existing){results.push({state,boardId:existing.id});continue;}
 const b=base.clone();b.name=name;b.x=13200+(i%2)*1400;b.y=Math.floor(i/2)*900;
 const old=penpotUtils.findShape(s=>s.type==='board'&&s.name===target,b);if(!old)throw Error('Missing '+target);
 const component=penpot.library.local.components.find(c=>c.path===`Desktop / Onboarding / ${target.endsWith('submit')?'Button':'Address input'}`&&c.name===variant);if(!component)throw Error('Missing variant');
 const p=old.parent,index=p.children.findIndex(s=>s.id===old.id),x=old.x,y=old.y,n=component.instance();p.insertChild(index,n);n.x=x;n.y=y;n.name=target;old.remove();
 b.setPluginData('capture',`design/penpot/populated/desktop-registration-reference/${state}.png`);
 b.setPluginData('status','Editable interaction state; text overrides and visual verification required');
 results.push({state,boardId:b.id});
}
return results;
