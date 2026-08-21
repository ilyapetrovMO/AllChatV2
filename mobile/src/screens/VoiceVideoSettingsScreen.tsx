import React, { useEffect, useState } from 'react';
import {
  NativeModules,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { mediaDevices } from 'react-native-webrtc';

import {
  DEFAULT_VOICE_VIDEO_SETTINGS,
  normalizeVoiceVideoSettings,
  type VoiceVideoSettings,
} from '../media/VoiceVideoSettings';

type Device = {
  deviceId: string;
  kind: string;
  label: string;
  facing?: string;
};
type Palette = {
  background: string;
  field: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
};

export function VoiceVideoSettingsScreen({
  initial,
  onBack,
  onChange,
  palette,
}: {
  initial: VoiceVideoSettings;
  onBack(): void;
  onChange(value: VoiceVideoSettings): void;
  palette: Palette;
}) {
  const [value, setValue] = useState(initial);
  const [devices, setDevices] = useState<Device[]>([]);
  const [routes, setRoutes] = useState<Array<{ id: string; name: string }>>([]);
  const [notice, setNotice] = useState(
    'Changes apply immediately to an active call.',
  );
  useEffect(() => {
    mediaDevices
      .enumerateDevices()
      .then(items => setDevices(items as Device[]))
      .catch(() =>
        setNotice(
          'Device discovery is unavailable. System defaults will be used.',
        ),
      );
    NativeModules.AllChatAudio?.listRoutes?.()
      .then((items: Array<{ id: string; name: string }>) => setRoutes(items))
      .catch(() => {});
  }, []);
  const update = (
    patch: Partial<VoiceVideoSettings>,
    message = 'Saved on this device.',
  ) => {
    const next = normalizeVoiceVideoSettings({ ...value, ...patch });
    setValue(next);
    onChange(next);
    setNotice(message);
  };
  const reset = () => {
    const next = normalizeVoiceVideoSettings(DEFAULT_VOICE_VIDEO_SETTINGS);
    setValue(next);
    onChange(next);
    setNotice('Voice & Video settings were reset.');
  };
  const choices = (
    label: string,
    current: string,
    items: Array<{
      deviceId?: string;
      id?: string;
      label?: string;
      name?: string;
    }>,
    key: 'microphoneID' | 'speakerID' | 'cameraID',
  ) => (
    <View style={styles.control}>
      <Text style={[styles.controlLabel, { color: palette.text }]}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.choiceRail}
      >
        <Choice
          active={!current}
          label="System default"
          onPress={() => update({ [key]: '' })}
          palette={palette}
        />
        {items.map(item => {
          const id = item.deviceId || item.id || '';
          return (
            <Choice
              active={current === id}
              key={id}
              label={item.label || item.name || 'Device'}
              onPress={() => {
                update({ [key]: id });
                if (key === 'speakerID')
                  NativeModules.AllChatAudio?.selectRoute?.(id);
              }}
              palette={palette}
            />
          );
        })}
      </ScrollView>
    </View>
  );
  return (
    <View style={[styles.fill, { backgroundColor: palette.background }]}>
      <View style={[styles.header, { borderBottomColor: palette.border }]}>
        <View>
          <Text style={[styles.title, { color: palette.text }]}>
            Voice & Video
          </Text>
          <Text style={[styles.headerCaption, { color: palette.muted }]}>
            Local media preferences
          </Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="Close Voice and Video settings"
          onPress={onBack}
          style={[styles.done, { borderColor: palette.border }]}
        >
          <Text style={[styles.doneText, { color: palette.text }]}>Done</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        stickyHeaderIndices={[0]}
      >
        <View
          style={[
            styles.sectionNav,
            {
              backgroundColor: palette.background,
              borderBottomColor: palette.border,
            },
          ]}
        >
          {['Voice', 'Processing', 'Camera', 'Advanced'].map(item => (
            <View
              key={item}
              style={[styles.navPill, { backgroundColor: palette.field }]}
            >
              <Text style={[styles.navText, { color: palette.muted }]}>
                {item}
              </Text>
            </View>
          ))}
        </View>
        <Section
          title="Voice"
          subtitle="Choose where sound enters and leaves your device."
          palette={palette}
        >
          {choices('Audio route', value.speakerID, routes, 'speakerID')}
          {choices(
            'Microphone',
            value.microphoneID,
            devices.filter(item => item.kind === 'audioinput'),
            'microphoneID',
          )}
          <NumberSetting
            label="Microphone volume"
            hint="Level sent to other Members"
            suffix="%"
            value={Math.round(value.inputGain * 100)}
            minimum={0}
            maximum={200}
            onChange={number => update({ inputGain: number / 100 })}
            palette={palette}
          />
          <NumberSetting
            label="Speaker volume"
            hint="All incoming voice audio"
            suffix="%"
            value={Math.round(value.outputVolume * 100)}
            minimum={0}
            maximum={100}
            onChange={number => update({ outputVolume: number / 100 })}
            palette={palette}
          />
        </Section>
        <Section
          title="Input processing"
          subtitle="Keep speech clear without sending microphone audio to a third party."
          palette={palette}
        >
          <View style={styles.control}>
            <Text style={[styles.controlLabel, { color: palette.text }]}>
              Noise suppression
            </Text>
            <View style={styles.segmented}>
              <Choice
                active={value.noiseSuppressionMode === 'standard'}
                label="Standard"
                onPress={() =>
                  update({
                    noiseSuppression: true,
                    noiseSuppressionMode: 'standard',
                  })
                }
                palette={palette}
              />
              <Choice
                active={value.noiseSuppressionMode === 'enhanced'}
                label="Enhanced"
                onPress={() =>
                  update({
                    noiseSuppression: true,
                    noiseSuppressionMode: 'enhanced',
                  })
                }
                palette={palette}
              />
              <Choice
                active={value.noiseSuppressionMode === 'off'}
                label="Off"
                onPress={() =>
                  update({
                    noiseSuppression: false,
                    noiseSuppressionMode: 'off',
                  })
                }
                palette={palette}
              />
            </View>
            <Text style={[styles.hint, { color: palette.muted }]}>
              Enhanced runs RNNoise locally. Standard remains the compatibility
              fallback.
            </Text>
          </View>
          <Toggle
            label="Echo cancellation"
            hint="Reduces speaker audio returning through your microphone"
            value={value.echoCancellation}
            onChange={enabled => update({ echoCancellation: enabled })}
            palette={palette}
          />
          <Toggle
            label="Automatic gain control"
            hint="Compensates for microphones that are unusually quiet"
            value={value.autoGainControl}
            onChange={enabled => update({ autoGainControl: enabled })}
            palette={palette}
          />
          <Toggle
            label="Noise gate"
            hint="Closes the microphone below the sensitivity threshold"
            value={value.noiseGate}
            onChange={enabled => update({ noiseGate: enabled })}
            palette={palette}
          />
          <NumberSetting
            label="Input sensitivity"
            hint="Higher values require louder sound"
            suffix=" dBFS"
            value={value.noiseGateThresholdDB}
            minimum={-80}
            maximum={-20}
            onChange={number => update({ noiseGateThresholdDB: number })}
            palette={palette}
          />
        </Section>
        <Section
          title="Camera"
          subtitle="Choose the camera used when video starts."
          palette={palette}
        >
          {choices(
            'Camera',
            value.cameraID,
            devices.filter(item => item.kind === 'videoinput'),
            'cameraID',
          )}
          <View
            style={[
              styles.preview,
              { backgroundColor: palette.field, borderColor: palette.border },
            ]}
          >
            <Text style={{ color: palette.muted }}>
              Camera preview is available when video starts.
            </Text>
          </View>
        </Section>
        <Section
          title="Screen sharing"
          subtitle="Choose whether readability, motion, or data usage has priority."
          palette={palette}
        >
          <View style={styles.segmented}>
            {(['auto', 'text', 'balanced', 'motion', 'data-saver'] as const).map(mode => (
              <Choice
                active={value.screenShareMode === mode}
                key={mode}
                label={mode === 'data-saver' ? 'Data saver' : mode[0].toUpperCase() + mode.slice(1)}
                onPress={() => update({screenShareMode: mode})}
                palette={palette}
              />
            ))}
          </View>
        </Section>
        <Section
          title="Advanced"
          subtitle="Recovery and diagnostic controls."
          palette={palette}
        >
          <View style={styles.settingRow}>
            <View style={styles.grow}>
              <Text style={[styles.controlLabel, { color: palette.text }]}>
                Reset Voice & Video settings
              </Text>
              <Text style={[styles.hint, { color: palette.muted }]}>
                Restore safe defaults for devices, processing, and volume.
              </Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Reset Voice and Video settings"
              onPress={reset}
              style={[styles.reset, { borderColor: palette.border }]}
            >
              <Text style={styles.resetText}>Reset</Text>
            </TouchableOpacity>
          </View>
        </Section>
        <Text
          accessibilityLiveRegion="polite"
          style={[
            styles.notice,
            { backgroundColor: palette.field, color: palette.muted },
          ]}
        >
          {notice}
        </Text>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  subtitle,
  palette,
  children,
}: React.PropsWithChildren<{
  title: string;
  subtitle: string;
  palette: Palette;
}>) {
  return (
    <View style={[styles.section, { borderBottomColor: palette.border }]}>
      <Text style={[styles.sectionTitle, { color: palette.text }]}>
        {title}
      </Text>
      <Text style={[styles.sectionSubtitle, { color: palette.muted }]}>
        {subtitle}
      </Text>
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: palette.field, borderColor: palette.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}
function Toggle({
  label,
  hint,
  value,
  onChange,
  palette,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange(value: boolean): void;
  palette: Palette;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.grow}>
        <Text style={[styles.controlLabel, { color: palette.text }]}>
          {label}
        </Text>
        <Text style={[styles.hint, { color: palette.muted }]}>{hint}</Text>
      </View>
      <Switch
        accessibilityLabel={label}
        trackColor={{ true: palette.accent }}
        onValueChange={onChange}
        value={value}
      />
    </View>
  );
}
function Choice({
  active,
  label,
  onPress,
  palette,
}: {
  active: boolean;
  label: string;
  onPress(): void;
  palette: Palette;
}) {
  return (
    <TouchableOpacity
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.choice,
        {
          borderColor: active ? palette.accent : palette.border,
          backgroundColor: active ? `${palette.accent}22` : palette.background,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.choiceText,
          active && styles.choiceTextActive,
          { color: active ? palette.accent : palette.text },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
function NumberSetting({
  label,
  hint,
  suffix,
  value,
  minimum,
  maximum,
  onChange,
  palette,
}: {
  label: string;
  hint: string;
  suffix: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange(value: number): void;
  palette: Palette;
}) {
  const commit = (text: string) => {
    const parsed = Number(text);
    if (Number.isFinite(parsed))
      onChange(Math.min(maximum, Math.max(minimum, parsed)));
  };
  return (
    <View style={styles.settingRow}>
      <View style={styles.grow}>
        <Text style={[styles.controlLabel, { color: palette.text }]}>
          {label}
        </Text>
        <Text style={[styles.hint, { color: palette.muted }]}>{hint}</Text>
      </View>
      <View
        style={[
          styles.numberBox,
          { borderColor: palette.border, backgroundColor: palette.background },
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          defaultValue={String(value)}
          inputMode="numeric"
          key={value}
          onEndEditing={event => commit(event.nativeEvent.text)}
          style={[styles.numberInput, { color: palette.text }]}
        />
        <Text style={{ color: palette.muted }}>{suffix}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  title: { fontSize: 21, fontWeight: '900' },
  headerCaption: { fontSize: 12, marginTop: 2 },
  done: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  doneText: { fontWeight: '700' },
  content: { paddingBottom: 48 },
  sectionNav: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  navPill: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  navText: { fontSize: 12, fontWeight: '700' },
  section: {
    borderBottomWidth: 1,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 26,
  },
  sectionTitle: { fontSize: 22, fontWeight: '800' },
  sectionSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 10 },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 14,
  },
  control: { gap: 9, paddingVertical: 15 },
  controlLabel: { fontSize: 15, fontWeight: '800' },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  choiceRail: { gap: 8, paddingRight: 12 },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    borderRadius: 9,
    borderWidth: 1,
    maxWidth: 240,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  choiceText: { fontWeight: '600' },
  choiceTextActive: { fontWeight: '800' },
  settingRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255,255,255,0.06)',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    minHeight: 72,
    paddingVertical: 12,
  },
  numberBox: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 9,
  },
  numberInput: { minWidth: 46, paddingVertical: 8, textAlign: 'right' },
  preview: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 150,
    justifyContent: 'center',
    marginBottom: 14,
    padding: 20,
  },
  reset: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  resetText: { color: '#ff6b6e', fontWeight: '800' },
  notice: { borderRadius: 10, margin: 16, padding: 12, textAlign: 'center' },
});
