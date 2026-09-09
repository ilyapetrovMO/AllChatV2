"""Extract horizontal borders of settled native validation bubbles from local captures."""
from PIL import Image
from pathlib import Path
import json
p=Path('design/penpot/milestones/55-community-general-validation')
states=json.loads((p/'measurements.json').read_text())
for s in states:
 im=Image.open(p/(s['key']+'-reference.png')).convert('RGB');rows=[]
 for y in range(int(s['bounds']['y']+s['bounds']['h'])+4,min(799,int(s['bounds']['y']+s['bounds']['h'])+90)):
  xs=[x for x in range(400,1200) if im.getpixel((x,y))==(132,132,132)]
  if len(xs)>100:rows.append((y,min(xs),max(xs)))
 if len(rows)<2:raise ValueError('No stable bubble border for '+s['key'])
 top,bottom=rows[0],rows[-1]
 left=top[1]-5;right=top[2]+5
 s['popup']={'x':left,'y':top[0],'w':right-left+1,'h':bottom[0]-top[0]+1}
(p/'measurements.json').write_text(json.dumps(states,indent=2)+'\n')
