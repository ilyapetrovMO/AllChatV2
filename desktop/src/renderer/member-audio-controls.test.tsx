import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MemberAudioControls,connectionPing,connectionQuality,ConnectionSignal} from './member-audio-controls';
import {loadDesktopVoicePreferences,saveDesktopVoicePreferences,defaultDesktopVoicePreferences,desktopMemberOutputVolume} from './voice-capture';
import * as capture from './voice-capture';
beforeEach(()=>localStorage.clear());
afterEach(()=>vi.restoreAllMocks());
describe('member audio controls',()=>{
 it('persists mute and deafen outside a call without opening the microphone',()=>{
  const acquire=vi.spyOn(capture,'captureDesktopMicrophone');
  const view=render(<MemberAudioControls memberId="me" inputStream={null} onVoiceSettings={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Mute microphone'}));expect(loadDesktopVoicePreferences('me').muted).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Deafen'}));expect(desktopMemberOutputVolume(loadDesktopVoicePreferences('me'),'sam')).toBe(0);
  fireEvent.click(screen.getByRole('button',{name:'Undeafen'}));expect(loadDesktopVoicePreferences('me').muted).toBe(true);
  view.unmount();render(<MemberAudioControls memberId="me" inputStream={null} onVoiceSettings={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Unmute microphone'})).toHaveAttribute('aria-pressed','true');expect(acquire).not.toHaveBeenCalled();
 });
 it('changes volume, navigates to Voice Settings, and restores focus on Escape',async()=>{
  const settings=vi.fn();render(<MemberAudioControls memberId="me" inputStream={null} onVoiceSettings={settings}/>);
  fireEvent.click(screen.getByRole('button',{name:'Headphones controls'}));
  fireEvent.change(screen.getByRole('slider',{name:'Output Volume'}),{target:{value:'0.42'}});
  expect(loadDesktopVoicePreferences('me').outputVolume).toBe(.42);
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('button',{name:'Headphones controls'})).toHaveFocus();
  fireEvent.click(screen.getByRole('button',{name:'Headphones controls'}));fireEvent.click(screen.getByRole('button',{name:'Voice Settings'}));expect(settings).toHaveBeenCalledOnce();
 });
 it('stops a late microphone meter acquisition after the popover closes',async()=>{
  let resolve!:(value:capture.DesktopMicrophoneCapture)=>void;
  vi.spyOn(capture,'captureDesktopMicrophone').mockReturnValue(new Promise(done=>resolve=done));
  render(<MemberAudioControls memberId="me" inputStream={null} onVoiceSettings={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Microphone controls'}));fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
  const stop=vi.fn();await act(async()=>resolve({stream:{} as MediaStream,enhanced:false,stop}));expect(stop).toHaveBeenCalledOnce();
 });
 it('uses the selected candidate pair for ping and has honest unknown and failure states',()=>{
  const report=new Map([['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{id:'pair',type:'candidate-pair',currentRoundTripTime:.105}],['old',{id:'old',type:'candidate-pair',nominated:true,state:'succeeded',currentRoundTripTime:1}]]) as unknown as RTCStatsReport;
  expect(connectionPing(report)).toBe(105);expect(connectionPing(new Map() as RTCStatsReport)).toBeNull();
  expect([105,230,650].map(p=>connectionQuality(p))).toEqual(['good','degraded','poor']);expect(connectionQuality(null)).toBe('unknown');expect(connectionQuality(105,false)).toBe('poor');
  const {container}=render(<ConnectionSignal ping={230} connected/>);expect(container.querySelectorAll('.filled')).toHaveLength(2);expect(screen.getByRole('tooltip')).toHaveTextContent('230 ms');
 });
});
