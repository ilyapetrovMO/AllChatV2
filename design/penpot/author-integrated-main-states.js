if(penpot.currentPage.name!=='Desktop — Login')throw Error('Expected main page');
const base=penpot.currentPage.root.children.find(b=>b.name==='Desktop / Main / Text channel');if(!base)throw Error('Missing main default');
const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
function box(parent,name,x,y,w,h,color,r=4){const s=penpot.createBoard();s.name=name;s.resize(w,h);s.fills=[{fillColor:color,fillOpacity:1}];s.borderRadius=r;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;}
function text(parent,name,copy,x,y,w,size=14,weight=400,color='#F0F1F5'){const t=penpot.createText(copy);t.name=name;font.applyToText(t,font.variants.find(v=>v.fontWeight===String(weight)&&v.fontStyle==='normal'));t.fontSize=String(size);t.resize(w,size*1.5);t.fills=[{fillColor:color,fillOpacity:1}];parent.appendChild(t);t.x=parent.x+x;t.y=parent.y+y;return t;}
function button(parent,name,copy,x,y,w){const s=box(parent,name,x,y,w,36,'#30323A');text(s,name+' label',copy,12,9,w-24,14,700);return s;}
const keys=['default','members-hidden','draft','sent','search','no-results'];const result=[];
for(const [index,key] of keys.entries()){
 const name='Main prototype / '+key;let b=penpot.currentPage.root.children.find(b=>b.name===name);
 if(!b){b=base.clone();b.name=name;b.x=12400+(index%2)*1400;b.y=7000+Math.floor(index/2)*1000;b.resize(1280,872);b.showInViewMode=true;b.clipContent=true;
 const find=name=>penpotUtils.findShape(s=>s.name===name,b);const workspace=find('Message workspace'),composer=find('Message composer');find('Attach file').remove();
 const send=box(composer,'Send message',642,6,64,32,'#6D75E8');text(send,'Send label','Send',12,6,45,14,700);
 if(key==='members-hidden'){find('Member directory').remove();workspace.resize(968,724);composer.resize(952,44);send.x+=240;find('Members toggled').fills=[];}
 if(key==='draft')find('Composer placeholder').characters='A local test message';
 if(['sent','search'].includes(key)){const a=box(workspace,'Sent avatar',16,126,40,40,'#6D75E8',20);text(a,'Sent avatar initial','A',14,10,20,14,700);text(workspace,'Sent author','Alex',72,126,50,15.2,700);text(workspace,'Sent time','Just now',122,129,90,11.52,400,'#727784');text(workspace,'Sent message','A local test message',72,148,610,16,400,'#DBDEE1');}
 if(['search','no-results'].includes(key)){
 const dir=find('Member directory');for(const s of [...dir.children])s.remove();find('Search placeholder').characters=key==='search'?'local test':'no-match-123';
 text(dir,'Search count',key==='search'?'1 result':'0 results',16,22,164,16,700);button(dir,'Close search','×',192,12,36);
 if(key==='search'){const card=box(dir,'Search result',8,68,224,154,'#101115');text(card,'Result author','Alex',12,12,90,14,700);text(card,'Result time','Just now',120,14,90,11,400,'#727784');text(card,'Result body','A local test message',12,45,200,14,400,'#DBDEE1');button(card,'Jump to message','Jump to message',12,100,192);}
 else text(dir,'No results message','No messages found.',16,80,208,14,400,'#A4A8B3');
 }
 const footer=box(b,'Prototype controls',0,800,1280,72,'#101115',0);text(footer,'State label','Main conversation · '+key,24,12,600,15,700);text(footer,'Instructions','Click fields to load examples. Use the browser prototype for typing.',24,39,650,12,400,'#A4A8B3');button(footer,'Search example','Search example',724,18,174);button(footer,'No results example','No results',910,18,144);button(footer,'Restart main','Restart',1066,18,190);
 b.setPluginData('main-prototype-state',key);
 }
 result.push({key,id:b.id});
}return result;
