import json
from pathlib import Path
from PIL import Image
p=Path('design/penpot/milestones/33-voice-hover');result={}
for key in ['range','button','checkbox','selector']:
 result[key]={}
 for state in ['default','hover']:
  im=Image.open(p/f'{key}-{state}.png').convert('RGB');result[key][state]=[{'rgb':color,'pixels':n} for n,color in sorted(im.getcolors(im.width*im.height),reverse=True)[:5]]
 result[key]['identicalPixels']=Image.open(p/f'{key}-default.png').tobytes()==Image.open(p/f'{key}-hover.png').tobytes()
im=Image.open(p/'range-hover.png').convert('RGB');ys=[y for y in range(im.height) if im.getpixel((40,y))!=(17,18,22)];result['range']['trackHeightAtX40']=max(ys)-min(ys)+1
(p/'pixel-comparison.json').write_text(json.dumps(result,indent=2));print('Compared four hover captures; range track height:',result['range']['trackHeightAtX40'])
