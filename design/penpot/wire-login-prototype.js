if(penpot.currentPage.name!=='Desktop — Login')throw Error('Expected Desktop — Login');
const page=penpot.currentPage;
const entries=page.root.children.filter(b=>b.name.startsWith('Login prototype / ')).map(b=>({board:b,spec:JSON.parse(b.getPluginData('login-prototype-spec'))}));
const states=Object.fromEntries(entries.map(e=>[e.spec.key,e.board]));
if(Object.keys(states).length!==20)throw Error('Expected 20 authentication prototype states');
function find(b,name){const s=penpotUtils.findShape(s=>s.name===name,b);if(!s)throw Error('Missing '+name+' in '+b.name);return s;}
const routes=[];
function link(from,shape,to){const target=states[to];if(!target)throw Error('Unknown destination '+to);shape.addInteraction('click',{type:'navigate-to',destination:target,preserveScrollPosition:false});routes.push({from,shapeId:shape.id,shapeName:shape.name,to,targetId:target.id});}
function control(from,b,name,to){link(from,find(b,name),to);const overlay=penpotUtils.findShape(s=>s.name===name.replace(' input',' value'),b);if(name.endsWith(' input')&&overlay)link(from,overlay,to);}
const loginRoutes={
 empty:['username','password','missing-username'],
 username:['username','ready','missing-password'],
 password:['ready','password','missing-username-password-filled'],
 ready:['ready','ready','success'],
 invalid:['ready','ready','error'],
 error:['retry','retry','error'],
 retry:['retry','retry','success'],
 'missing-username':['username','password','missing-username'],
 'missing-password':['username','ready','missing-password'],
 'missing-username-password-filled':['ready','password','missing-username-password-filled'],
 recovered:['recovered-ready','recovered-ready','missing-username'],
 'recovered-ready':['recovered-ready','recovered-ready','success'],
};
for(const {board:b,spec} of entries){
 for(const s of [b,...penpotUtils.findShapes(()=>true,b)])for(const i of [...s.interactions])s.removeInteraction(i);
 if(spec.key==='guide'){
  control(spec.key,b,'Start login','empty');control(spec.key,b,'Try failed login','invalid');control(spec.key,b,'Try recovery','recovery');continue;
 }
 control(spec.key,b,'Restart','guide');
 if(spec.key==='success'){control(spec.key,b,'Success restart','guide');continue;}
 const mode=spec.mode||'login';
 for(const [label,to] of [['Sign in','empty'],['Register','register'],['Recovery','recovery']]){
  const tab=find(b,'Tab / '+label);penpotUtils.findShape(s=>s.type==='text',tab).characters=label;link(spec.key,tab,to);
 }
 const submit=find(b,'Submit');penpotUtils.findShape(s=>s.type==='text',submit).characters=mode==='register'?'Create Account':mode==='recover'?'Replace password':'Sign in';
 const filled=mode==='register'?'register-ready':mode==='recover'?'recovery-ready':spec.confirmation?'recovered-ready':spec.error?'retry':'ready';
 control(spec.key,b,'Fill example',filled);
 if(mode==='login'){
  const [username,password,target]=loginRoutes[spec.key];control(spec.key,b,'Username input',username);control(spec.key,b,'Password input',password);link(spec.key,submit,target);
 }else{
  for(const name of mode==='register'?['Invitation token','Username','Password']:['Recovery token','New password'])control(spec.key,b,name+' input',filled);
  link(spec.key,submit,spec.filled?(mode==='register'?'success':'recovered'):(mode==='register'?'register-required':'recovery-required'));
 }
}
const base=page.root.children.find(s=>s.name==='Desktop / Login / Default');
for(const s of penpotUtils.findShapes(()=>true,base))for(const i of [...s.interactions])s.removeInteraction(i);
for(const [name,to] of [['Username input','username'],['Password input','password'],['Sign in submit','missing-username'],['Authentication tab / Sign in','empty'],['Authentication tab / Register','register'],['Authentication tab / Recovery','recovery']])control('default',base,name,to);
for(const [name,key] of [['Desktop login — prototype','guide'],['Desktop login — sign in','empty'],['Desktop login — failed sign-in','invalid']]){
 const flow=page.flows.find(f=>f.name===name);if(flow)flow.startingBoard=states[key];else page.createFlow(name,states[key]);
}
// Penpot creates unnamed flows while initially connecting disconnected boards.
const ownedIds=new Set([...Object.values(states).map(b=>b.id),base.id]);
for(const flow of [...page.flows])if(/^Flow \d+$/.test(flow.name)&&ownedIds.has(flow.startingBoard.id))page.removeFlow(flow);
penpot.viewport.zoomIntoView([states.guide]);
return {boards:Object.fromEntries(Object.entries(states).map(([k,b])=>[k,b.id])),routes,flows:page.flows.map(f=>({name:f.name,startingBoard:f.startingBoard.id})),validation:penpot.currentFile.validate()};
