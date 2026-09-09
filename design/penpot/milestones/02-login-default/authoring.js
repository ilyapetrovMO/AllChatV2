// Restart milestone 02: one default desktop sign-in screen, no other screens.
if (penpot.currentFile.id !== 'c828d3cf-7d4e-8145-8008-9a4f1a6ff37f' || penpot.currentPage.name !== 'Desktop — Login') throw Error('Expected Desktop — Login in the existing file');
const existing = penpot.currentPage.root.children.find(s => s.name === 'Desktop / Login / Default');
if (existing) return {boardId: existing.id, existing: true};
const font = penpot.fonts.findAllByName('Inter').find(f => f.name === 'Inter');
if (!font) throw Error('Exact Inter family unavailable');
const palette = {rail:'#0D0E11',surface:'#18191E',input:'#202127',text:'#F0F1F5',muted:'#A4A8B3',faint:'#727784',brand:'#6D75E8',selected:'#5962D6',active:'#30323A',hover:'#26282F',white:'#FFFFFF'};
let set=penpot.library.local.tokens.sets.find(s=>s.name==='Desktop Login');
if(!set)set=penpot.library.local.tokens.addSet({name:'Desktop Login'});
if(!set.active)set.toggleActive();
const tokens={};for(const [name,value] of Object.entries(palette))tokens[name]=set.tokens.find(t=>t.name===`login.color.${name}`)||set.addToken({name:`login.color.${name}`,type:'color',value});
function fill(s,color){s.fills=[{fillColor:palette[color],fillOpacity:1}];s.applyToken(tokens[color],['fill']);}
function board(name,parent,x,y,w,h,color,r=0){const s=penpot.createBoard();s.name=name;s.resize(w,h);s.fills=[];s.borderRadius=r;if(parent)parent.appendChild(s);s.x=(parent?.x||0)+x;s.y=(parent?.y||0)+y;if(color)fill(s,color);return s;}
function rect(name,parent,x,y,w,h,color,r=0){const s=penpot.createRectangle();s.name=name;s.resize(w,h);s.borderRadius=r;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;fill(s,color);return s;}
function text(name,copy,parent,x,y,w,size,weight,color,align='left'){
 const s=penpot.createText(copy);s.name=name;
 const variant=font.variants.find(v=>v.fontWeight===String(weight)&&v.fontStyle==='normal');if(!variant)throw Error('Missing font weight '+weight);
 font.applyToText(s,variant);s.fontSize=String(size);s.resize(w,size*1.4);s.align=align;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;fill(s,color);return s;
}
function icon(name,parent,x,y,w,h,viewBox,paths,color,stroke=2){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" fill="none" stroke="${palette[color]}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${paths.map(d=>`<path d="${d}"/>`).join('')}</svg>`;
 const s=penpot.createShapeFromSvg(svg);s.name=name;s.resize(w,h);
 const scale=w/Number(viewBox.split(' ')[2]);
 for(const p of penpotUtils.findShapes(p=>p.type==='path',s))p.strokes=p.strokes.map(v=>({...v,strokeWidth:stroke*scale}));
 parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;
}
const kit=board('Login / Reusable controls',null,2040,0,480,520,'surface',8);
text('Control kit title','Login controls',kit,48,28,384,20,700,'text');
const mains=[
 board('Empty input',kit,48,100,384,42.28,'input',4),
 board('Primary button',kit,48,180,384,43.17,'brand',4),
 board('Selected tab',kit,48,270,125.333333,43.17,'active',4),
 board('Idle tab',kit,48,360,125.333333,43.17,null,4),
];
text('Button label','Sign in',mains[1],0,11.39,384,16,700,'white','center');
text('Selected tab label','Sign in',mains[2],0,11.39,125.333333,16,700,'text','center');
text('Idle tab label','Register',mains[3],0,11.39,125.333333,16,700,'muted','center');
const components=mains.map(m=>{const c=penpot.library.local.createComponent([m]);c.name=m.name;c.path='Desktop / Login';return c;});
const b=board('Desktop / Login / Default',null,640,0,1280,720,'rail');
const title=board('Desktop title bar',b,0,0,1280,28,'rail');
text('Application name','AllChat',title,10,5.8,80,11,700,'faint');
rect('Title bar divider',title,0,27,1280,1,'surface');
icon('Minimize',title,1179,7.5,12,12,'0 0 12 12',['M2 6.5h8'],'muted',1.25);
icon('Maximize',title,1217,7.5,12,12,'0 0 12 12',['M2.25 2.25h7.5v7.5h-7.5Z'],'muted',1.25);
icon('Close',title,1255,7.5,12,12,'0 0 12 12',['m2.5 2.5 7 7m0-7-7 7'],'muted',1.25);
const rail=board('Community rail',b,0,28,72,692,'rail');
rect('Home button',rail,12,12,48,48,'brand',16);
icon('Home icon',rail,27.38,27.38,17.25,17.25,'0 0 24 24',['m3 11 9-8 9 8','M5 10v10h14V10','M9 20v-6h6v6'],'white');
rect('Selected community',rail,12,70,48,48,'selected',12);
text('Community initial','1',rail,12,86,48,15,800,'white','center');
rect('Selected community indicator',rail,0,74,4,40,'white',2);
rect('Add community button',rail,12,632,48,48,'hover',16);
icon('Add community icon',rail,25,645,22,22,'0 0 24 24',['M12 5v14M5 12h14'],'muted');
const content=board('Authentication background',b,72,28,1208,692);
const radius=Math.hypot(604,692)*.38;
content.fills=[{fillColorGradient:{type:'radial',startX:.5,startY:0,endX:.5+radius/1208,endY:0,width:1208/692,stops:[{offset:0,color:'#404EED',opacity:1},{offset:1,color:palette.rail,opacity:1}]}}];
const card=board('Authentication card',content,364,73.67,480,544.66,'surface',8);
card.shadows=[{style:'drop-shadow',offsetX:0,offsetY:12,blur:32,spread:0,color:{color:'#000000',opacity:.46}}];
text('Community name','127.0.0.1:4187',card,48,50,384,12,800,'faint','center');
text('Login heading line 1','Sign in to your',card,48,94.19,384,28,700,'text','center');
text('Login heading line 2','Community',card,48,133.38,384,28,700,'text','center');
text('Community address','http://127.0.0.1:4187',card,48,180.56,384,16,400,'muted','center');
const instances=[];
function instance(component,name,x,y){const s=component.instance();s.name=name;card.appendChild(s);s.x=card.x+x;s.y=card.y+y;instances.push({name,id:s.id,componentId:component.id});return s;}
instance(components[2],'Authentication tab / Sign in',48,227.16);
instance(components[3],'Authentication tab / Register',177.333333,227.16);
instance(components[3],'Authentication tab / Recovery',306.666666,227.16);
const u=text('Username label','USERNAME',card,48,289.33,384,12.8,700,'muted');u.letterSpacing='.256';
instance(components[0],'Username input',48,312.63);
const p=text('Password label','PASSWORD',card,48,371.91,384,12.8,700,'muted');p.letterSpacing='.256';
instance(components[0],'Password input',48,395.21);
instance(components[1],'Sign in submit',48,453.49);
b.setPluginData('source','desktop/src/renderer/app.tsx:98,368; desktop/src/renderer/styles.css:241,256,534');
b.setPluginData('reference','design/penpot/populated/desktop-sign-in-reference/sign-in.png');
b.setPluginData('milestone','02-default-login');
b.setPluginData('instances',JSON.stringify(instances));
b.setPluginData('typography','Inter from the application CSS; Linux reference uses DejaVu Sans fallback, not available in connected font library');
storage.loginDefault={boardId:b.id,kitId:kit.id,instances,components:components.map(c=>({id:c.id,name:c.name,path:c.path}))};
return storage.loginDefault;
