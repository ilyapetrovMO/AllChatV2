"""Extract horizontal borders of settled native validation bubbles from local captures."""
from PIL import Image
from pathlib import Path
import json
p=Path('design/penpot/milestones/49-safety-small-validation')
states=json.loads((p/'measurements.json').read_text())
for s in states:
 im=Image.open(p/(s['key']+'-reference.png')).convert('RGB');rows=[]
 for y in range(int(s['bounds']['y']+s['bounds']['h'])+4,min(639,int(s['bounds']['y']+s['bounds']['h'])+90)):
  xs=[x for x in range(250,960) if im.getpixel((x,y))==(132,132,132)]
  if len(xs)>100:rows.append((y,min(xs),max(xs)))
 if len(rows)<2:raise ValueError('No stable bubble border for '+s['key'])
 top,bottom=rows[0],rows[-1]
 s['popup']={'x':top[1]-3,'y':top[0],'w':top[2]-top[1]+7,'h':bottom[0]-top[0]+1}
(p/'measurements.json').write_text(json.dumps(states,indent=2)+'\n')
