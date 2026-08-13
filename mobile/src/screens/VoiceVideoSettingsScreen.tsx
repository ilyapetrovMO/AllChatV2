import React, {useEffect, useState} from 'react';
import {NativeModules, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {mediaDevices} from 'react-native-webrtc';

import {normalizeVoiceVideoSettings, type VoiceVideoSettings} from '../media/VoiceVideoSettings';

type Device = {deviceId: string; kind: string; label: string; facing?: string};
type Palette = {background: string; field: string; border: string; text: string; muted: string; accent: string};

export function VoiceVideoSettingsScreen({initial, onBack, onChange, palette}: {initial: VoiceVideoSettings; onBack(): void; onChange(value: VoiceVideoSettings): void; palette: Palette}) {
  const [value, setValue] = useState(initial); const [devices, setDevices] = useState<Device[]>([]); const [routes, setRoutes] = useState<Array<{id: string; name: string}>>([]); const [notice, setNotice] = useState('');
  useEffect(() => { mediaDevices.enumerateDevices().then(items => setDevices(items as Device[])).catch(() => setNotice('Device discovery is unavailable. Default devices will be used.')); NativeModules.AllChatAudio?.listRoutes?.().then((items: Array<{id: string; name: string}>) => setRoutes(items)).catch(() => {}); }, []);
  const update = (patch: Partial<VoiceVideoSettings>) => { const next = normalizeVoiceVideoSettings({...value, ...patch}); setValue(next); onChange(next); };
  const toggle = (label: string, key: 'echoCancellation' | 'noiseSuppression' | 'autoGainControl' | 'noiseGate') => <View style={styles.row}><Text style={[styles.label, {color: palette.text}]}>{label}</Text><Switch accessibilityLabel={label} onValueChange={enabled => update({[key]: enabled})} value={value[key]} /></View>;
  const choices = (label: string, current: string, items: Array<{deviceId?: string; id?: string; label?: string; name?: string}>, key: 'microphoneID' | 'speakerID' | 'cameraID') => <View style={styles.group}><Text style={[styles.label, {color: palette.text}]}>{label}</Text><View style={styles.wrap}><Choice active={!current} label="System default" onPress={() => update({[key]: ''})} palette={palette} />{items.map(item => { const id = item.deviceId || item.id || ''; return <Choice active={current === id} key={id} label={item.label || item.name || 'Device'} onPress={() => { update({[key]: id}); if (key === 'speakerID') NativeModules.AllChatAudio?.selectRoute?.(id); }} palette={palette} />; })}</View></View>;
  return <View style={[styles.fill, {backgroundColor: palette.background}]}><View style={[styles.header, {borderBottomColor: palette.border}]}><Text style={[styles.title, {color: palette.text}]}>Voice & Video</Text><TouchableOpacity accessibilityLabel="Close Voice and Video settings" onPress={onBack}><Text style={{color: palette.accent}}>Done</Text></TouchableOpacity></View><ScrollView contentContainerStyle={styles.content}>
    <Text style={{color: palette.muted}}>Preferences are stored on this device. Audio changes apply to the active call; camera changes apply the next time video starts.</Text>
    {notice ? <Text style={{color: palette.muted}}>{notice}</Text> : null}
    {choices('Audio route', value.speakerID, routes, 'speakerID')}
    {choices('Microphone', value.microphoneID, devices.filter(item => item.kind === 'audioinput'), 'microphoneID')}
    {choices('Camera', value.cameraID, devices.filter(item => item.kind === 'videoinput'), 'cameraID')}
    <View style={styles.group}><Text style={[styles.label, {color: palette.text}]}>Noise suppression</Text><View style={styles.wrap}>
      <Choice active={value.noiseSuppressionMode === 'standard'} label="Standard" onPress={() => update({noiseSuppression: true, noiseSuppressionMode: 'standard'})} palette={palette} />
      <Choice active={value.noiseSuppressionMode === 'enhanced'} label="Enhanced (RNNoise)" onPress={() => update({noiseSuppression: true, noiseSuppressionMode: 'enhanced'})} palette={palette} />
      <Choice active={value.noiseSuppressionMode === 'off'} label="Off" onPress={() => update({noiseSuppression: false, noiseSuppressionMode: 'off'})} palette={palette} />
    </View><Text style={{color: palette.muted}}>Enhanced runs locally. Standard suppression remains active automatically if the native RNNoise processor is unavailable.</Text></View>
    <View style={[styles.card, {backgroundColor: palette.field}]}>{toggle('Echo cancellation', 'echoCancellation')}{toggle('Automatic gain control', 'autoGainControl')}{toggle('Noise gate', 'noiseGate')}</View>
    <NumberSetting label="Noise gate threshold (dBFS)" value={value.noiseGateThresholdDB} minimum={-80} maximum={-20} onChange={number => update({noiseGateThresholdDB: number})} palette={palette} />
    <NumberSetting label="Outgoing microphone volume (%)" value={Math.round(value.inputGain * 100)} minimum={0} maximum={200} onChange={number => update({inputGain: number / 100})} palette={palette} />
    <NumberSetting label="Incoming voice volume (%)" value={Math.round(value.outputVolume * 100)} minimum={0} maximum={100} onChange={number => update({outputVolume: number / 100})} palette={palette} />
  </ScrollView></View>;
}

function Choice({active, label, onPress, palette}: {active: boolean; label: string; onPress(): void; palette: Palette}) { return <TouchableOpacity accessibilityState={{selected: active}} onPress={onPress} style={[styles.choice, {borderColor: active ? palette.accent : palette.border, backgroundColor: palette.field}]}><Text style={{color: palette.text}}>{label}</Text></TouchableOpacity>; }
function NumberSetting({label, value, minimum, maximum, onChange, palette}: {label: string; value: number; minimum: number; maximum: number; onChange(value: number): void; palette: Palette}) { const commit = (text: string) => { const parsed = Number(text); if (Number.isFinite(parsed)) onChange(Math.min(maximum, Math.max(minimum, parsed))); }; return <View style={styles.group}><Text style={[styles.label, {color: palette.text}]}>{label}</Text><TextInput accessibilityLabel={label} defaultValue={String(value)} inputMode="numeric" key={value} onEndEditing={event => commit(event.nativeEvent.text)} style={[styles.input, {borderColor: palette.border, color: palette.text}]} /></View>; }

const styles = StyleSheet.create({fill: {flex: 1}, header: {alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 16}, title: {fontSize: 20, fontWeight: '800'}, content: {gap: 16, padding: 16}, card: {borderRadius: 10, paddingHorizontal: 12}, row: {alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 52}, group: {gap: 8}, label: {fontSize: 15, fontWeight: '700'}, wrap: {flexDirection: 'row', flexWrap: 'wrap', gap: 8}, choice: {borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9}, input: {borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10}});
