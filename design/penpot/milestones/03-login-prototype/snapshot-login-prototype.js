const page=penpot.currentPage;
const versions=await penpot.currentFile.findVersions();
const version=versions.find(v=>v.label==='Desktop login — milestone 03 navigable prototype');
if(!version)throw Error('Named milestone missing');
const boards=page.root.children.filter(b=>b.name.startsWith('Login prototype / '));
return {fileId:penpot.currentFile.id,pageId:page.id,revision:penpot.currentFile.revn,version:JSON.parse(JSON.stringify(version)),boards:boards.map(b=>({id:b.id,name:b.name,spec:JSON.parse(b.getPluginData('login-prototype-spec')),shapes:[b,...penpotUtils.findShapes(()=>true,b)].map(s=>({id:s.id,name:s.name,type:s.type,parentId:s.parent?.id,x:s.x,y:s.y,width:s.width,height:s.height,characters:s.type==='text'?s.characters:undefined,interactions:s.interactions.map(i=>({trigger:i.trigger,type:i.action.type,destination:i.action.destination?.id}))}))})),flows:page.flows.map(f=>({name:f.name,startId:f.startingBoard.id}))};
