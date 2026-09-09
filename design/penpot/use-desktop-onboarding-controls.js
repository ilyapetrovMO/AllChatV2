const b=penpotUtils.findShapeById('6bdc1c40-ce96-804f-8008-9a624d6665de');
if(b.getPluginData('onboarding-instances'))return JSON.parse(b.getPluginData('onboarding-instances'));
const all=[];function walk(s){all.push(s);for(const c of s.children||[])walk(c)}walk(b);const result=[];
for(const [kind,label,height] of [['Button','Add Instance',43.17],['Address input','chat.example',42.28]]){
 const name=`Desktop / Onboarding / ${kind} / Default`,component=penpot.library.local.components.find(c=>[c.path,c.name].filter(Boolean).join(' / ')===name);
 if(!component)throw Error('Missing component '+name);
 const background=all.find(s=>s.type==='rectangle'&&Math.abs(s.width-384)<.01&&Math.abs(s.height-height)<.02),text=all.find(s=>s.type==='text'&&s.characters===label);
 if(!background||!text)throw Error('Original control missing');
 const parent=background.parent,index=parent.children.findIndex(s=>s.id===background.id),x=background.x,y=background.y;
 const instance=component.instance();parent.insertChild(index,instance);instance.x=x;instance.y=y;
 background.remove();text.remove();result.push({kind,componentId:component.id,instanceId:instance.id});
}
b.setPluginData('onboarding-instances',JSON.stringify(result));b.setPluginData('font-evidence','Linux Chromium reports DejaVu Sans; unavailable in Penpot, as is Segoe UI. Inter remains an explicit substitution. See desktop-rendered-fonts.json.');return result;
