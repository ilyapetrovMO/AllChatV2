if(penpot.currentPage.name!=='Desktop — Main')throw Error('Expected main page');const base=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Main / Text channel');const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
function box(parent,name,x,y,w,h,color,r=4){const s=penpot.createBoard();s.name=name;s.resize(w,h);s.fills=[{fillColor:color,fillOpacity:1}];s.borderRadius=r;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;}
function text(parent,name,copy,x,y,w,size=14,weight=400,color='#F0F1F5'){const t=penpot.createText(copy);t.name=name;font.applyToText(t,font.variants.find(v=>v.fontWeight===String(weight)&&v.fontStyle==='normal'));t.fontSize=String(size);t.resize(w,size*1.4);t.fills=[{fillColor:color,fillOpacity:1}];parent.appendChild(t);t.x=parent.x+x;t.y=parent.y+y;return t;}
const keys=['own-actions','other-actions','pinned-actions','deleted','reply-composer','edit-composer'];const results=[];
for(const [index,key] of keys.entries()){
 const name='Desktop / Main / Message / '+key;let b=penpot.currentPage.root.children.find(b=>b.name===name);
 if(!b){b=base.clone();b.name=name;b.x=7400+(index%2)*1400;b.y=Math.floor(index/2)*960;b.showInViewMode=false;for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const i of [...s.interactions])s.removeInteraction(i);
 const find=name=>penpotUtils.findShape(s=>s.name===name,b);const workspace=find('Message workspace');
 if(key.endsWith('actions')){const labels=key==='other-actions'?['Reply','React','Pin','Report']:['Reply','React',key==='pinned-actions'?'Unpin':'Pin','Edit','Delete'];let x=728-16-labels.reduce((n,s)=>n+s.length*7+18,0)-(labels.length-1)*5;const group=box(workspace,'Message action bar',x,20,728-16-x,30,'#18191E',0);x=0;for(const label of labels){const width=label.length*7+18;const button=box(group,'Action / '+label,x,0,width,30,'#18191E');text(button,'Action label / '+label,label,9,7,width-18,12,400,'#9299AD');x+=width+5;}
 if(key==='other-actions'){find('Message author 0').characters='Sam';penpotUtils.findShape(s=>s.type==='text',find('Message avatar 0')).characters='S';}
 if(key==='pinned-actions'){text(workspace,'Pinned indicator','PINNED',72,64,120,11,400,'#F0B232');for(const n of ['Message avatar 1','Message author 1','Message timestamp 1','Message body 1'])find(n).y+=22;}}
 if(key==='deleted')find('Message body 0').characters='Message deleted';
 if(key.endsWith('composer')){const c=find('Message composer');c.y-=42;c.resize(712,86);c.fills=[{fillColor:'#222329',fillOpacity:1}];find('Composer placeholder').y+=42;find('Attach file').y+=42;const editing=key==='edit-composer';text(c,'Composer context',editing?'Editing Message':'Replying to a Message',7,14,190,12,400,'#A4A8B3');const cancel=box(c,'Cancel context',editing?102:137,5,65.59375,34,'#6D75E8',17);text(cancel,'Cancel label','Cancel',12,9,48,12,600,'#98A0FF');if(editing){find('Composer placeholder').characters='Welcome to the community.';find('Composer placeholder').fills=[{fillColor:'#F0F1F5',fillOpacity:1}];}}
 b.setPluginData('static-message-state',key);
 }
 results.push({key,id:b.id});
}return results;
