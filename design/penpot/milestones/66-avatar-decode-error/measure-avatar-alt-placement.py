from PIL import Image
from pathlib import Path
import json
p=Path('design/penpot/milestones/66-avatar-decode-error');target=Image.open(p/'wide-avatar-reference.png').convert('RGB');template=Image.open(p/'alt-text-template.png').convert('RGB')
results=[]
for text,source_baseline,start,end in [('Community',50,16,39),('avatar',100,40,61)]:
 best=None
 for left in range(-40,6):
  for baseline in range(start+8,end+4):
   score=0
   for y in range(start,end):
    for x in range(64):
     sx=x-left+50;sy=y-baseline+source_baseline
     expected=template.getpixel((sx,sy)) if 0<=sx<256 and 0<=sy<128 else (109,117,232)
     actual=target.getpixel((x,y));score+=sum(abs(a-b) for a,b in zip(actual,expected))
   if best is None or score<best[0]:best=(score,left,baseline)
 results.append({'text':text,'pixelDifference':best[0],'left':best[1],'baseline':best[2]})
(p/'alt-placement.json').write_text(json.dumps(results,indent=2)+'\n');print(results)
