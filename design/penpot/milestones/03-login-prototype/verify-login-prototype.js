const page=penpot.currentPage;
const boards=page.root.children.filter(b=>b.name.startsWith('Login prototype / '));
const states=Object.fromEntries(boards.map(b=>[JSON.parse(b.getPluginData('login-prototype-spec')).key,b]));
const keyById=Object.fromEntries(Object.entries(states).map(([k,b])=>[b.id,k]));
const graph={};const problems=[];const summaries=[];
for(const [key,b] of Object.entries(states)){
 const shapes=penpotUtils.findShapes(()=>true,b);
 graph[key]=[];
 for(const s of [b,...shapes])for(const i of s.interactions){
  const to=keyById[i.action.destination?.id];
  if(i.trigger!=='click'||i.action.type!=='navigate-to'||!to)problems.push('Invalid link '+key+' / '+s.name);
  else graph[key].push({shape:s.name,to,shapeId:s.id});
 }
 const text=shapes.filter(s=>s.type==='text');
 if(text.some(t=>!t.textBounds||t.textBounds.width<=0||t.textBounds.height<=0))problems.push('Unrendered text '+key);
 const labels=text.map(t=>t.characters);
 if(!['guide','success'].includes(key)){
  for(const label of ['Sign in','Register','Recovery'])if(!labels.includes(label))problems.push('Missing tab '+key+' '+label);
  if(!graph[key].some(e=>e.shape==='Restart'&&e.to==='guide'))problems.push('Missing restart '+key);
 }
 summaries.push({key,id:b.id,nativeTextLayers:text.length,links:graph[key].length,width:b.width,height:b.height});
}
const seen=new Set();const queue=['guide'];while(queue.length){const k=queue.shift();if(seen.has(k))continue;seen.add(k);for(const e of graph[k]||[])queue.push(e.to);}
if(seen.size!==boards.length)problems.push('Unreachable states: '+Object.keys(states).filter(k=>!seen.has(k)).join(', '));
function route(start,names,end){let key=start;for(const name of names){const e=graph[key].find(e=>e.shape===name);if(!e){problems.push('Missing route '+key+' / '+name);return;}key=e.to;}if(key!==end)problems.push('Wrong route endpoint '+key+' expected '+end);}
route('guide',['Start login','Username input','Password input','Submit'],'success');
route('guide',['Start login','Submit'],'missing-username');
route('guide',['Start login','Username input','Submit'],'missing-password');
route('guide',['Try failed login','Submit','Fill example','Submit'],'success');
route('guide',['Try recovery','Fill example','Submit','Fill example','Submit'],'success');
route('empty',['Tab / Register','Submit'],'register-required');
route('empty',['Tab / Register','Fill example','Submit'],'success');
route('success',['Success restart'],'guide');
const validation=penpot.currentFile.validate();if(validation.length)problems.push('Penpot file validation failed');
return {pass:problems.length===0,problems,revision:penpot.currentFile.revn,reachableStates:seen.size,summaries,graph,flows:page.flows.map(f=>({name:f.name,start:keyById[f.startingBoard.id]})),validation};
