import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {captureDesktopMicrophone, defaultDesktopVoicePreferences, loadDesktopVoicePreferences, saveDesktopVoicePreferences, type DesktopVoicePreferences} from './voice-capture';

const paths = {
 mic: <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,
 headphones: <><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/></>,
 camera: <><rect x="2" y="5" width="13" height="14" rx="2"/><path d="m15 10 7-4v12l-7-4z"/></>,
 screen: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4m-4-12 4-4 4 4m-4-4v9"/></>,
 activity: <path d="m7 2 2 4 4 2-4 2-2 4-2-4-4-2 4-2zm11 10 2 3 3 2-3 2-2 3-2-3-3-2 3-2z"/>,
 soundboard: <path d="M5 17V9m5 11V4m5 14V7m5 8v-4"/>,
 chevron: <path d="m6 9 6 6 6-6"/>,
 settings: <><path d="m9 3 1-2h4l1 2 3 2 2 .1 2 3-1 2v4l1 2-2 3-2 .1-3 2-1 2h-4l-1-2-3-2-2-.1-2-3 1-2v-4l-1-2 2-3L6 5z"/><circle cx="12" cy="12" r="3"/></>,
 phone: <path d="M2 15v-4a18 18 0 0 1 20 0v4h-5v-4a14 14 0 0 0-10 0v4z"/>,
};
export function PanelIcon({name,slash=false}:{name:keyof typeof paths;slash?:boolean}) {
 return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}{slash&&<path d="M3 3l18 18"/>}</svg>;
}
export function connectionQuality(ping: number | null, connected=true): 'good'|'degraded'|'poor'|'unknown' {
 if (!connected) return 'poor';
 if (ping===null || !Number.isFinite(ping)) return 'unknown';
 return ping < 150 ? 'good' : ping < 300 ? 'degraded' : 'poor';
}
export function connectionPing(report: RTCStatsReport): number | null {
 let selected: string|undefined;
 report.forEach(entry=>{if(entry.type==='transport'&&entry.selectedCandidatePairId)selected=entry.selectedCandidatePairId;});
 let rtt:number|null=null;
 report.forEach(entry=>{if(entry.type==='candidate-pair'&&(selected?entry.id===selected:entry.state==='succeeded'&&(entry.nominated||entry.selected))&&typeof entry.currentRoundTripTime==='number')rtt=entry.currentRoundTripTime;});
 return rtt===null||!Number.isFinite(rtt)?null:Math.max(0,Math.round(rtt*1000));
}
export function ConnectionSignal({ping,connected}:{ping:number|null;connected:boolean}) {
 const quality=connectionQuality(ping,connected),bars={good:4,degraded:2,poor:1,unknown:0}[quality];
 const label=!connected?'Reconnecting…':ping===null?'Measuring ping…':`${ping} ms`;
 return <span className={`connection-signal ${quality}`} tabIndex={0} aria-label={`Connection quality: ${label}`}><span className="signal-bars" aria-hidden="true">{[0,1,2,3].map(i=><i key={i} className={i<bars?'filled':''} style={{height:4+i*4}}/>)}</span><span className="signal-tooltip" role="tooltip">{label}</span></span>;
}

export function MemberAudioControls({memberId,inputStream,onVoiceSettings}:{memberId:string;inputStream:MediaStream|null;onVoiceSettings():void}) {
 const [preferences,setPreferences]=useState(()=>loadDesktopVoicePreferences(memberId));
 const [open,setOpen]=useState<'input'|'output'|null>(null);
 const [devices,setDevices]=useState<MediaDeviceInfo[]>([]);
 const [notice,setNotice]=useState('');
 const [level,setLevel]=useState(0);
 const [position,setPosition]=useState({left:8,top:8});
 const inputButton=useRef<HTMLButtonElement>(null),outputButton=useRef<HTMLButtonElement>(null),popover=useRef<HTMLDivElement>(null);
 useEffect(()=>{const update=()=>setPreferences(loadDesktopVoicePreferences(memberId));update();window.addEventListener('allchat:voice-settings',update);return()=>window.removeEventListener('allchat:voice-settings',update);},[memberId]);
 const patch=(next:Partial<DesktopVoicePreferences>)=>setPreferences(saveDesktopVoicePreferences(memberId,{...loadDesktopVoicePreferences(memberId),...next}));
 const close=()=>{setOpen(null);(open==='input'?inputButton:outputButton).current?.focus();};
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{const anchor=(open==='input'?inputButton:outputButton).current?.getBoundingClientRect(),box=popover.current?.getBoundingClientRect();if(anchor&&box)setPosition({left:Math.max(8,Math.min(innerWidth-box.width-8,anchor.left-box.width+32)),top:Math.max(8,anchor.top-box.height-8)});};
  place();popover.current?.focus();window.addEventListener('resize',place);
  const dismiss=(event:MouseEvent)=>{if(event.target instanceof Node&&!popover.current?.contains(event.target)&&!inputButton.current?.contains(event.target)&&!outputButton.current?.contains(event.target))setOpen(null);};
  document.addEventListener('mousedown',dismiss);return()=>{window.removeEventListener('resize',place);document.removeEventListener('mousedown',dismiss);};
 },[open,notice]);
 useEffect(()=>{
  if(!open)return;let current=true;setNotice('');
  const refresh=()=>void navigator.mediaDevices?.enumerateDevices().then(list=>{if(current)setDevices(list);}).catch(()=>{if(current)setNotice('Audio devices are unavailable.');});
  refresh();navigator.mediaDevices?.addEventListener?.('devicechange',refresh);return()=>{current=false;navigator.mediaDevices?.removeEventListener?.('devicechange',refresh);};
 },[open]);
 useEffect(()=>{
  if(open!=='input')return;let disposed=false,stop:(()=>void)|undefined,context:AudioContext|undefined,timer:number|undefined;
  void (async()=>{try{
   const capture=inputStream?null:await captureDesktopMicrophone(memberId);
   if(disposed){capture?.stop();return;}stop=capture?.stop;
   const stream=inputStream||capture!.stream;
   if(typeof AudioContext==='undefined'||!stream.getAudioTracks().length)return;
   context=new AudioContext();const analyser=context.createAnalyser();analyser.fftSize=256;context.createMediaStreamSource(stream).connect(analyser);await context.resume();
   if(disposed)return;const samples=new Float32Array(analyser.fftSize);
   timer=window.setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);setLevel(Math.min(25,Math.round(rms*100)));},80);
  }catch{if(!disposed)setNotice('Microphone access is needed to show the input level.');}})();
  return()=>{disposed=true;if(timer!==undefined)clearInterval(timer);stop?.();void context?.close().catch(()=>undefined);setLevel(0);};
 },[open,inputStream,memberId,preferences.microphoneID,preferences.noiseSuppressionMode,preferences.echoCancellation,preferences.autoGainControl,preferences.inputGain]);
 const muted=Boolean(preferences.muted||preferences.deafened);
 return <>
  <div className={`member-audio-pair${muted?' muted':''}`}>
   <button type="button" aria-label={muted?'Unmute microphone':'Mute microphone'} title={muted?'Unmute microphone':'Mute microphone'} aria-pressed={muted} onClick={()=>patch({muted:!muted,...(muted?{deafened:false}:{})})}><PanelIcon name="mic" slash={muted}/></button>
   <button ref={inputButton} className="audio-chevron" type="button" aria-label="Microphone controls" aria-expanded={open==='input'} aria-haspopup="dialog" onClick={()=>setOpen(open==='input'?null:'input')}><PanelIcon name="chevron"/></button>
  </div>
  <div className={`member-audio-pair${preferences.deafened?' muted':''}`}>
   <button type="button" aria-label={preferences.deafened?'Undeafen':'Deafen'} title={preferences.deafened?'Undeafen':'Deafen'} aria-pressed={Boolean(preferences.deafened)} onClick={()=>patch({deafened:!preferences.deafened})}><PanelIcon name="headphones" slash={preferences.deafened}/></button>
   <button ref={outputButton} className="audio-chevron" type="button" aria-label="Headphones controls" aria-expanded={open==='output'} aria-haspopup="dialog" onClick={()=>setOpen(open==='output'?null:'output')}><PanelIcon name="chevron"/></button>
  </div>
  {open&&createPortal(<div ref={popover} className="member-audio-popover" role="dialog" aria-label={open==='input'?'Microphone controls':'Headphones controls'} tabIndex={-1} style={position} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
   <label className="audio-device-field"><strong>{open==='input'?'Input Device':'Output Device'}</strong><select aria-label={open==='input'?'Input Device':'Output Device'} value={open==='input'?preferences.microphoneID:preferences.speakerID} onChange={event=>patch(open==='input'?{microphoneID:event.target.value}:{speakerID:event.target.value})}><option value="">System Default</option>{devices.filter(d=>d.kind===(open==='input'?'audioinput':'audiooutput')&&d.deviceId!=='default').map((device,index)=><option key={device.deviceId} value={device.deviceId}>{device.label||`Device ${index+1}`}</option>)}</select></label>
   {open==='input'&&<label className="audio-device-field"><strong>Input Profile</strong><select aria-label="Input Profile" value={preferences.noiseSuppressionMode} onChange={event=>patch({noiseSuppressionMode:event.target.value as DesktopVoicePreferences['noiseSuppressionMode'],...(event.target.value==='standard'?{echoCancellation:defaultDesktopVoicePreferences.echoCancellation}: {})})}><option value="standard">Standard</option><option value="enhanced">Enhanced noise suppression</option><option value="off">Noise suppression off</option></select></label>}
   <label className="audio-volume-field"><strong>{open==='input'?'Input Volume':'Output Volume'}</strong><input type="range" aria-label={open==='input'?'Input Volume':'Output Volume'} min="0" max={open==='input'?2:1} step="0.01" value={open==='input'?preferences.inputGain:preferences.outputVolume} onChange={event=>patch(open==='input'?{inputGain:Number(event.target.value)}:{outputVolume:Number(event.target.value)})}/></label>
   {open==='input'&&<div className="audio-input-level"><strong>Input Level</strong><div role="meter" aria-label="Input Level" aria-valuemin={0} aria-valuemax={25} aria-valuenow={level}>{Array.from({length:25},(_,i)=><i key={i} className={i<level?'active':''}/>)}</div></div>}
   {notice&&<p role="status">{notice}</p>}
   <button className="audio-settings-link" type="button" onClick={()=>{setOpen(null);onVoiceSettings();}}><PanelIcon name="settings"/>Voice Settings</button>
  </div>,document.body)}
 </>;
}
