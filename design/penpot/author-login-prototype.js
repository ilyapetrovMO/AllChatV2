// Click-through authentication prototype. Product canvas is 1280x720; demo controls sit below it.
if(penpot.currentFile.id!=='c828d3cf-7d4e-8145-8008-9a4f1a6ff37f'||penpot.currentPage.name!=='Desktop — Login')throw Error('Expected Desktop — Login');
const base=penpot.currentPage.root.children.find(s=>s.name==='Desktop / Login / Default');
if(!base)throw Error('Default login board required');
const font=penpot.fonts.findAllByName('Inter').find(f=>f.name==='Inter');
const components=penpot.library.local.components.filter(c=>c.path==='Desktop / Login');
const component=name=>{const c=components.find(c=>c.name===name);if(!c)throw Error('Missing '+name);return c;};
const specs=[
 {key:'guide',label:'Choose a login scenario'},
 {key:'empty',label:'Sign in'},
 {key:'username',label:'Username entered',username:'visual-owner'},
 {key:'password',label:'Password entered',password:true},
 {key:'ready',label:'Ready to sign in',username:'visual-owner',password:true},
 {key:'invalid',label:'Invalid credentials example',username:'catalog-no-such-member',password:true,invalid:true},
 {key:'error',label:'Login failed',username:'catalog-no-such-member',password:true,invalid:true,error:true},
 {key:'retry',label:'Corrected credentials — error retained',username:'visual-owner',password:true,error:true},
 {key:'missing-username',label:'Username required',required:'Username'},
 {key:'missing-password',label:'Password required',username:'visual-owner',required:'Password'},
 {key:'missing-username-password-filled',label:'Username required',password:true,required:'Username'},
 {key:'register',label:'Register',mode:'register'},
 {key:'register-required',label:'Invitation token required',mode:'register',required:'Invitation token'},
 {key:'register-ready',label:'Registration example filled',mode:'register',filled:true},
 {key:'recovery',label:'Recovery',mode:'recover'},
 {key:'recovery-required',label:'Recovery token required',mode:'recover',required:'Recovery token'},
 {key:'recovery-ready',label:'Recovery example filled',mode:'recover',filled:true},
 {key:'recovered',label:'Password replaced',confirmation:true},
 {key:'recovered-ready',label:'Sign in with replacement password',confirmation:true,username:'visual-owner',password:true},
 {key:'success',label:'Signed in — prototype complete'},
];
const results={};
function text(parent,name,copy,x,y,w,size=16,weight=400,color='#F0F1F5',align='left'){
 const t=penpot.createText(copy);t.name=name;font.applyToText(t,font.variants.find(v=>v.fontWeight===String(weight)&&v.fontStyle==='normal'));t.fontSize=String(size);t.resize(w,size*1.4);t.align=align;t.fills=[{fillColor:color,fillOpacity:1}];parent.appendChild(t);t.x=parent.x+x;t.y=parent.y+y;return t;
}
function board(parent,name,x,y,w,h,color,r=0){const b=penpot.createBoard();b.name=name;b.resize(w,h);b.borderRadius=r;b.fills=color?[{fillColor:color,fillOpacity:1}]:[];if(parent)parent.appendChild(b);b.x=(parent?.x||0)+x;b.y=(parent?.y||0)+y;return b;}
function button(parent,name,label,x,y,w=160){const b=board(parent,name,x,y,w,40,'#30323A',4);text(b,name+' label',label,0,9,w,14,700,'#F0F1F5','center');return b;}
function instance(parent,name,which,x,y){const s=component(which).instance();s.name=name;parent.appendChild(s);s.x=parent.x+x;s.y=parent.y+y;return s;}
for(const [index,spec] of specs.entries()){
 const name='Login prototype / '+spec.key;
 const existing=penpot.currentPage.root.children.find(s=>s.name===name);
 if(existing){results[spec.key]={boardId:existing.id,...spec};continue;}
 let b;
 if(spec.key==='guide'||spec.key==='success')b=board(null,name,2800+(index%3)*1400,Math.floor(index/3)*940,1280,792,'#0D0E11');
 else{b=base.clone();b.name=name;b.x=2800+(index%3)*1400;b.y=Math.floor(index/3)*940;b.resize(1280,792);penpotUtils.findShape(s=>s.name==='Authentication card',b).remove();}
 b.showInViewMode=true;b.clipContent=true;
 if(spec.key==='guide'){
  text(b,'Prototype title','Explore desktop login',144,120,992,36,700);
  text(b,'Prototype explanation','Click fields to load sample values, then submit.\nUse the browser prototype for real typing and keyboard validation.',144,188,992,18,400,'#A4A8B3').resize(992,60);
  button(b,'Start login','Start login',144,306,300);
  button(b,'Try failed login','Failed login & retry',144,366,300);
  button(b,'Try recovery','Password recovery',144,426,300);
  text(b,'Prototype scope','Authentication only. Successful submission ends at a completion panel.',144,528,992,16,400,'#A4A8B3');
 }else if(spec.key==='success'){
  text(b,'Success title','Signed in to your Community',160,250,960,32,700,'#F0F1F5','center');
  text(b,'Success explanation','Login flow complete. Restart to explore another authentication path.',160,318,960,18,400,'#A4A8B3','center');
  button(b,'Success restart','Restart login',490,390,300);
 }else{
  const mode=spec.mode||'login';
  const cardY=mode==='register'?79.97:mode==='recover'?121.27:spec.error?52:spec.confirmation?64.08:101.67;
  const cardH=mode==='register'?588.05:mode==='recover'?505.47:spec.error?645.44:spec.confirmation?619.84:544.66;
  const content=penpotUtils.findShape(s=>s.name==='Authentication background',b);
  const card=board(content,'Authentication card',364,cardY-28,480,cardH,'#18191E',8);card.shadows=[{style:'drop-shadow',offsetX:0,offsetY:12,blur:32,spread:0,color:{color:'#000000',opacity:.46}}];
  text(card,'Community name','127.0.0.1:4187',48,50,384,12,800,'#727784','center');
  const twoLines=mode==='login';
  text(card,'Authentication heading',mode==='login'?'Sign in to your':mode==='register'?'Join your Community':'Recover your Account',48,94.19,384,28,700,'#F0F1F5','center');
  if(twoLines)text(card,'Authentication heading line 2','Community',48,133.38,384,28,700,'#F0F1F5','center');
  text(card,'Community address','http://127.0.0.1:4187',48,twoLines?180.56:141.37,384,16,400,'#A4A8B3','center');
  const tabsY=twoLines?227.16:187.97;
  for(const [i,[m,label]] of [['login','Sign in'],['register','Register'],['recover','Recovery']].entries())instance(card,'Tab / '+label,mode===m?'Selected tab':'Idle tab',48+i*129.333333,tabsY);
  const fields=mode==='register'?[['Invitation token','demo-invite'],['Username','demo-member'],['Password','•'.repeat(24)]]:mode==='recover'?[['Recovery token','demo-recovery'],['New password','•'.repeat(28)]]:[['Username',spec.username||''],['Password',spec.password?'•'.repeat(spec.invalid?24:26):'']];
  const firstLabel=twoLines?289.33:250.14;
  for(const [i,[label,value]] of fields.entries()){
   const ly=firstLabel+i*82.58,iy=ly+23.30;
   text(card,label+' label',label.toUpperCase(),48,ly,384,12.8,700,'#A4A8B3').letterSpacing='.256';
   const input=instance(card,label+' input','Empty input',48,iy);
   const copy=(mode==='login'||spec.filled)?value:'';
   if(copy)text(card,label+' value',copy,60,iy+12,360,12.8,700);
   if(spec.required===label){
    const ring=board(card,'Native validation focus',44,iy-4,392,50.28,null,7);ring.strokes=[{strokeColor:'#00A8FC',strokeOpacity:1,strokeWidth:3,strokeStyle:'solid',strokeAlignment:'inner'}];
    const tooltip=board(card,'Browser validation reference',136,iy+50,208,40,'#383838',3);
    text(tooltip,'Validation message','Please fill out this field.',10,11,188,14,400,'#F0F1F5');
    tooltip.setPluginData('ownership','Browser-owned required-field validation reference');
   }
  }
  const sy=firstLabel+(fields.length-1)*82.58+81.58;
  instance(card,'Submit','Primary button',48,sy);
  if(spec.error)for(const [i,copy] of ['Error invoking remote method',"'allchat:instance:login': Error: invalid username",'or password'].entries())text(card,'Login error '+i,copy,48,499.66+i*25.59,384,16,400,'#A4A8B3','center');
  if(spec.confirmation)for(const [i,copy] of ['Password replaced. Sign in with your new','password.'].entries())text(card,'Recovery confirmation '+i,copy,48,499.65+i*25.60,384,16,400,'#A4A8B3','center');
  for(const s of card.children.filter(s=>['Native validation focus','Browser validation reference'].includes(s.name)))s.bringToFront();
 }
 const footer=board(b,'Prototype controls',0,720,1280,72,'#101115');
 text(footer,'Current prototype state',spec.label,24,12,780,15,700);
 text(footer,'Prototype instructions',spec.key==='success'?'Login flow complete. Restart to explore another path.':'Click-through demo: fields load examples; Restart returns to scenarios.',24,37,780,12,400,'#A4A8B3');
 if(!['guide','success'].includes(spec.key))button(footer,'Fill example',spec.error?'Correct credentials':'Fill example',860,16,176);
 if(spec.key!=='guide')button(footer,'Restart','Restart demo',1052,16,204);
 b.setPluginData('login-prototype-spec',JSON.stringify(spec));
 results[spec.key]={boardId:b.id,...spec};
}
storage.loginPrototype=results;
return results;
