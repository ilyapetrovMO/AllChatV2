from pathlib import Path
import re,html,json
src=Path('desktop/src/renderer/app.tsx').read_text();start=src.index('<section className="settings-panel voice-video-settings"');s=src[start:src.index('\n  );',start)]
prefs={'microphoneID':'','speakerID':'','cameraID':'','inputGain':1,'outputVolume':1,'noiseSuppressionMode':'standard','echoCancellation':True,'autoGainControl':False,'noiseGate':True,'noiseGateThresholdDB':-50,'screenShareMode':'auto'}
out='';i=0;expressions=[]
while i<len(s):
 if s[i]!='{':out+=s[i];i+=1;continue
 j=i+1;depth=1;quote=None
 while depth:
  ch=s[j]
  if quote:
   if ch=='\\':j+=2;continue
   if ch==quote:quote=None
  elif ch in "'\"`":quote=ch
  elif ch=='{':depth+=1
  elif ch=='}':depth-=1
  j+=1
 expr=s[i+1:j-1].strip();expressions.append(expr);m=re.search(r'(\w+)=$',out)
 if m:
  attr=m[1];out=out[:m.start()]
  if attr.startswith('on') or attr=='ref':pass
  elif attr=='value':out+='value="'+html.escape(str(prefs[expr.split('.')[1]]),quote=True)+'"'
  elif attr=='checked':out+='checked' if prefs[expr.split('.')[1]] else ''
  elif attr=='hidden':out+='hidden' if expr=='!cameraStream' else ''
  else:raise ValueError((attr,expr))
 elif expr.startswith(('microphones.map','speakers.map','cameras.map')) or expr=='notice':pass
 elif expr.startswith('Math.round('):out+='100'
 elif expr=='preferences.noiseGateThresholdDB':out+='-50'
 elif expr=='cameraStream ? "Stop Video" : "Test Video"':out+='Test Video'
 else:raise ValueError(expr)
 i=j
out=out.replace('className=','class=');out=re.sub(r'(<video\b[^>]*?)/>',r'\1></video>',out)
p=Path('design/penpot/milestones/37-voice-minimum');(p/'source-fixture.html').write_text(out);(p/'fixture-extraction.json').write_text(json.dumps({'source':'desktop/src/renderer/app.tsx:VoiceVideoSettings','preferences':prefs,'replacedExpressions':expressions},indent=2));print('Extracted static JSX fixture:',len(expressions),'expressions handled.')
