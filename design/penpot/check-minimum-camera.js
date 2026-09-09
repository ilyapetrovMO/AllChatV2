const boards=penpot.currentPage.root.children.filter(b=>b.getPluginData('static-minimum-camera-state')),problems=[],details=[];
for(const b of boards){const shapes=penpotUtils.findShapes(()=>true,b),find=n=>shapes.find(s=>s.name===n),key=b.getPluginData('static-minimum-camera-state'),portrait=key==='portrait',preview=find('Camera preview'),frame=find('Synthetic video frame'),button=find('Stop Video button'),label=find('Stop Video label'),notice=find('Voice settings notice'),c=find('Settings scroll content'),h=portrait?320:304.875,w=portrait?180:542;
if(b.width!==960||b.height!==640||Math.abs(preview.width-542)>.1||Math.abs(preview.height-h)>.1||Math.abs(frame.width-w)>.1||Math.abs(frame.height-h)>.1||Math.abs(frame.x-preview.x-(542-w)/2)>.1||Math.abs(frame.y-preview.y)>.1)problems.push(key+': geometry');
if(shapes.some(s=>s.type==='text'&&['Camera preview is off','Test Video'].includes(s.characters)))problems.push(key+': stale off copy');
if(label?.characters!=='Stop Video'||notice?.characters!=='Camera preview started.'||!label?.textBounds?.width||!notice?.textBounds?.width)problems.push(key+': text');
if(Math.abs(label.x+label.textBounds.width/2-button.x-button.width/2)>1)problems.push(key+': label alignment');
const target=key.endsWith('notice')?notice:button;if(target.y<b.y+76||target.y+target.height>b.y+640)problems.push(key+': target hidden');
if(shapes.some(s=>s.interactions.length)||b.interactions.length)problems.push(key+': interactions');
for(const s of frame.children)if(s.x<frame.x-.1||s.y<frame.y-.1||s.x+s.width>frame.x+frame.width+.1||s.y+s.height>frame.y+frame.height+.1)problems.push(key+': video bars');
details.push({key,preview:{w:preview.width,h:preview.height},frame:{w:frame.width,h:frame.height},contentHeight:c.height,targetY:target.y-b.y,labelBounds:label.textBounds});}
const validation=penpot.currentFile.validate();return {pass:boards.length===3&&!problems.length&&!validation.length,problems,validation,details};
