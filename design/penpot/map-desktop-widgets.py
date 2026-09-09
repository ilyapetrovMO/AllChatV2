import json
from pathlib import Path
root=Path(__file__).resolve().parent
items=json.loads((root/'desktop-message-native-progress.json').read_text())
for item in items:
 name=item['name'];item['source']='desktop/src/renderer/app.tsx';item['line']=3059 if name.startswith('image-viewer') else 2781 if name.startswith('reaction-picker') else 2818
 item['reference']=f'populated/desktop-message-reference/{name}.png'
 item['status']='native draft; image assets, paint order and visual verification pending'
(root/'desktop-message-source-mappings.json').write_text(json.dumps(items,indent=2)+'\n')
