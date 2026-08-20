/**
 * AllChat Android client foundation.
 *
 * @format
 */

import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';

import {AllChatClient} from './src/client/AllChatClient';
import {normalizeInstanceURL} from './src/domain/instance';
import {CallBanner, CommunityScreen, type GlobalIncomingCall} from './src/screens/CommunityScreen';
import {VoiceVideoSettingsScreen} from './src/screens/VoiceVideoSettingsScreen';
import {InstanceAccount, KeychainSessionVault, SessionVault} from './src/session/SessionVault';
import {DEFAULT_VOICE_VIDEO_SETTINGS, KeychainVoiceVideoSettingsStore, type VoiceVideoSettings} from './src/media/VoiceVideoSettings';
import {APP_VERSION, downloadUpdate, isNewerVersion} from './src/updates/AppUpdater';
import {removeMobilePush, syncMobilePush} from './src/notifications/MobilePush';

const defaultVault = new KeychainSessionVault();
const voiceSettingsStore = new KeychainVoiceVideoSettingsStore();

export type AppProps = {vault?: SessionVault};

export const incomingCallModalStatusBarTranslucent = false;

function App({vault = defaultVault}: AppProps): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppContent vault={vault} />
    </SafeAreaProvider>
  );
}

function AppContent({vault}: {vault: SessionVault}): React.JSX.Element {
  const dark = useColorScheme() !== 'light';
  const palette = useMemo(() => (dark ? darkPalette : lightPalette), [dark]);
  const [accounts, setAccounts] = useState<InstanceAccount[]>();
  const [active, setActive] = useState<InstanceAccount>();
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceVideoSettings>(DEFAULT_VOICE_VIDEO_SETTINGS);
  const [instanceInput, setInstanceInput] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    vault.list().then(items => {
      if (mounted) {
        setAccounts(items);
        setActive(items[0]);
      }
    }).catch(error => {
      if (mounted) {
        setAccounts([]);
        setStatus(error instanceof Error ? error.message : 'Could not read secure account storage.');
      }
    });
    return () => { mounted = false; };
  }, [vault]);

  useEffect(() => { if (active) voiceSettingsStore.load(active.instance_url, active.member.id).then(setVoiceSettings); }, [active]);

  async function signIn() {
    setSubmitting(true);
    setStatus('');
    try {
      const instanceURL = normalizeInstanceURL(instanceInput, __DEV__);
      const session = await new AllChatClient(instanceURL).login(username, password, 'AllChat Android');
      const next = await vault.put(instanceURL, session);
      setAccounts(next);
      setActive(next[0]);
      setAdding(false);
      setManaging(false);
      setPassword('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut(account: InstanceAccount) {
    setSubmitting(true);
    setStatus('');
    let revokeError = '';
    try {
      await removeMobilePush(account).catch(() => {});
      await new AllChatClient(account.instance_url).logout(account.session_token);
    } catch {
      revokeError = 'The account was removed from this device, but its remote Session could not be revoked. Revoke it from Member Settings when online.';
    }
    try {
      const next = await vault.remove(account.instance_url);
      setAccounts(next);
      setActive(next[0]);
      setAdding(next.length === 0);
      setStatus(revokeError);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not remove the account securely.');
    } finally {
      setSubmitting(false);
    }
  }

  const shellStyle = [styles.screen, {backgroundColor: palette.background}];
  if (accounts === undefined) {
    return <SafeAreaView style={shellStyle}><StatusBar barStyle={dark ? 'light-content' : 'dark-content'} /><View style={styles.centered}><ActivityIndicator color={palette.accent} /></View></SafeAreaView>;
  }

  if (active && !adding) {
    return <ActiveCommunity account={active} accounts={accounts} dark={dark} managing={managing} onAdd={() => setAdding(true)} onCloseSettings={() => setVoiceSettingsOpen(false)} onManage={() => setManaging(true)} onOpenCommunity={() => setManaging(false)} onOpenSettings={() => setVoiceSettingsOpen(true)} onSelectAccount={setActive} onSignOut={() => signOut(active)} onVoiceSettingsChange={next => { setVoiceSettings(next); voiceSettingsStore.save(active.instance_url, active.member.id, next).catch(() => {}); }} palette={palette} status={status} submitting={submitting} voiceSettings={voiceSettings} voiceSettingsOpen={voiceSettingsOpen} />;
  }

  return (
    <SafeAreaView style={shellStyle}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={styles.form}>
        <Text style={[styles.eyebrow, {color: palette.accent}]}>ALLCHAT MOBILE</Text>
        <Text style={[styles.title, {color: palette.text}]}>Add an Instance</Text>
        <Text style={[styles.copy, {color: palette.muted}]}>Sign in with the address and Member account for your Community.</Text>
        <TextInput accessibilityLabel="Instance address" autoCapitalize="none" autoCorrect={false} inputMode="url" onChangeText={setInstanceInput} placeholder="https://chat.example.com" placeholderTextColor={palette.placeholder} style={[styles.input, {backgroundColor: palette.field, borderColor: palette.border, color: palette.text}]} value={instanceInput} />
        <TextInput accessibilityLabel="Username" autoCapitalize="none" autoComplete="username" onChangeText={setUsername} placeholder="Username" placeholderTextColor={palette.placeholder} style={[styles.input, {backgroundColor: palette.field, borderColor: palette.border, color: palette.text}]} value={username} />
        <TextInput accessibilityLabel="Password" autoComplete="current-password" onChangeText={setPassword} placeholder="Password" placeholderTextColor={palette.placeholder} secureTextEntry style={[styles.input, {backgroundColor: palette.field, borderColor: palette.border, color: palette.text}]} value={password} />
        {status ? <Text style={styles.error}>{status}</Text> : null}
        <TouchableOpacity accessibilityRole="button" disabled={submitting} onPress={signIn} style={[styles.button, {backgroundColor: palette.accent}, submitting && styles.disabled]}>
          {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </TouchableOpacity>
        {accounts.length > 0 ? <TouchableOpacity accessibilityRole="button" onPress={() => { setAdding(false); setManaging(Boolean(active)); }} style={styles.cancelButton}><Text style={{color: palette.muted}}>Cancel</Text></TouchableOpacity> : null}
      </View>
    </SafeAreaView>
  );
}

type Palette = typeof darkPalette;

function ActiveCommunity({account, accounts, dark, managing, onAdd, onCloseSettings, onManage, onOpenCommunity, onOpenSettings, onSelectAccount, onSignOut, onVoiceSettingsChange, palette, status, submitting, voiceSettings, voiceSettingsOpen}: {
  account: InstanceAccount; accounts: InstanceAccount[]; dark: boolean; managing: boolean;
  onAdd(): void; onCloseSettings(): void; onManage(): void; onOpenCommunity(): void; onOpenSettings(): void;
  onSelectAccount(account: InstanceAccount): void; onSignOut(): void; onVoiceSettingsChange(settings: VoiceVideoSettings): void;
  palette: Palette; status: string; submitting: boolean; voiceSettings: VoiceVideoSettings; voiceSettingsOpen: boolean;
}) {
  const [incomingCall, setIncomingCall] = useState<GlobalIncomingCall>();
  useEffect(() => {
    syncMobilePush(account).catch(() => {});
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') syncMobilePush(account).catch(() => {});
    });
    return () => subscription.remove();
  }, [account]);
  const name = account.member.display_name || account.member.username;
  const shellStyle = [styles.screen, {backgroundColor: palette.background}];
  return <SafeAreaView style={shellStyle}>
    <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
    <CommunityScreen account={account} onGlobalIncomingCallChange={setIncomingCall} onManage={onManage} onVoiceSettingsChange={onVoiceSettingsChange} palette={palette} voiceSettings={voiceSettings} />
    <UpdatePrompt account={account} palette={palette} />
    <Modal animationType="slide" onRequestClose={voiceSettingsOpen ? onCloseSettings : onOpenCommunity} visible={managing}>
      {voiceSettingsOpen ? <SafeAreaView style={shellStyle}><VoiceVideoSettingsScreen initial={voiceSettings} onBack={onCloseSettings} onChange={onVoiceSettingsChange} palette={palette} /></SafeAreaView> : <SafeAreaView style={shellStyle}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <View style={styles.accountHeader}>
          <View style={styles.grow}>
            <Text style={[styles.eyebrow, {color: palette.accent}]}>ACTIVE INSTANCE</Text>
            <Text numberOfLines={1} style={[styles.instanceTitle, {color: palette.text}]}>{instanceName(account.instance_url)}</Text>
            <Text style={[styles.copy, {color: palette.muted}]}>{name} · @{account.member.username}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={onAdd} style={[styles.smallButton, {borderColor: palette.border}]}><Text style={{color: palette.text}}>Add</Text></TouchableOpacity>
        </View>
        <View style={styles.accountList}>
          <Text style={[styles.sectionTitle, {color: palette.text}]}>Your Instances</Text>
          {accounts.map(item => <TouchableOpacity accessibilityRole="button" key={item.instance_url} onPress={() => onSelectAccount(item)} style={[styles.account, {backgroundColor: palette.field, borderColor: item.instance_url === account.instance_url ? palette.accent : palette.border}]}><Text style={[styles.accountName, {color: palette.text}]}>{instanceName(item.instance_url)}</Text><Text style={{color: palette.muted}}>@{item.member.username}</Text></TouchableOpacity>)}
          {status ? <Text style={[styles.notice, {color: palette.muted}]}>{status}</Text> : null}
          <TouchableOpacity accessibilityRole="button" onPress={onOpenCommunity} style={[styles.button, {backgroundColor: palette.accent}]}><Text style={styles.buttonText}>Open Community</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={onOpenSettings} style={[styles.button, styles.secondaryButton, {backgroundColor: palette.field, borderColor: palette.border}]}><Text style={[styles.secondaryButtonText, {color: palette.text}]}>Voice & Video Settings</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={submitting} onPress={onSignOut} style={styles.dangerButton}><Text style={styles.dangerText}>{submitting ? 'Signing out…' : 'Sign out of this Instance'}</Text></TouchableOpacity>
        </View>
      </SafeAreaView>}
    </Modal>
    <Modal animationType="fade" onRequestClose={() => incomingCall?.onAction('decline')} statusBarTranslucent={incomingCallModalStatusBarTranslucent} transparent visible={Boolean(incomingCall)}>
      <View pointerEvents="box-none" style={styles.globalCallLayer}>
        {incomingCall ? <CallBanner call={incomingCall.call} currentMemberID={incomingCall.currentMemberID} onAction={incomingCall.onAction} onOpen={incomingCall.onOpen} palette={palette} /> : null}
      </View>
    </Modal>
  </SafeAreaView>;
}

function UpdatePrompt({account, palette}: {account: InstanceAccount; palette: Palette}) {
  const [version, setVersion] = useState('');
  const [dismissed, setDismissed] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const current = await new AllChatClient(account.instance_url).instanceVersion();
        if (mounted && current.apk_available && isNewerVersion(current.version)) setVersion(current.version);
      } catch {}
    };
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { mounted = false; clearInterval(timer); subscription.remove(); };
  }, [account.instance_url]);

  if (!version || dismissed === version) return null;
  const start = async () => {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await downloadUpdate(account.instance_url, account.session_token, version));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not download the update.');
    } finally {
      setBusy(false);
    }
  };
  return <Modal animationType="fade" transparent visible>
    <View style={styles.updateBackdrop}>
      <View style={[styles.updateCard, {backgroundColor: palette.field, borderColor: palette.border}]}>
        <Text style={[styles.sectionTitle, {color: palette.text}]}>AllChat {version} is available</Text>
        <Text style={[styles.copy, {color: palette.muted}]}>This Instance is newer than your mobile app ({APP_VERSION}). Download the matching APK through this Instance.</Text>
        {message ? <Text style={[styles.notice, {color: palette.muted}]}>{message}</Text> : null}
        <TouchableOpacity disabled={busy} onPress={start} style={[styles.button, {backgroundColor: palette.accent}, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Download update</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDismissed(version)} style={styles.cancelButton}><Text style={{color: palette.muted}}>Later</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}

function instanceName(instanceURL: string): string {
  return new URL(instanceURL).host;
}

const darkPalette = {background: '#191a1f', field: '#25272e', border: '#393c46', text: '#f5f6fb', muted: '#aeb2c0', placeholder: '#747988', accent: '#5865f2'};
const lightPalette = {background: '#f4f5f8', field: '#ffffff', border: '#d8dbe4', text: '#171820', muted: '#5e6370', placeholder: '#858a97', accent: '#4752c4'};

const styles = StyleSheet.create({
  globalCallLayer: {justifyContent: 'flex-start', flex: 1, paddingTop: 8},
  screen: {flex: 1}, centered: {alignItems: 'center', flex: 1, justifyContent: 'center'}, grow: {flex: 1},
  form: {flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 14},
  accountHeader: {alignItems: 'center', flexDirection: 'row', gap: 16, padding: 24},
  accountList: {flex: 1, gap: 12, paddingHorizontal: 24},
  eyebrow: {fontSize: 12, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4},
  title: {fontSize: 30, fontWeight: '800', letterSpacing: -0.6}, instanceTitle: {fontSize: 24, fontWeight: '800'}, sectionTitle: {fontSize: 18, fontWeight: '700'},
  copy: {fontSize: 16, lineHeight: 23, marginBottom: 10}, notice: {fontSize: 14, lineHeight: 20},
  input: {borderRadius: 10, borderWidth: 1, fontSize: 16, minHeight: 52, paddingHorizontal: 16},
  button: {alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 52, marginTop: 4},
  secondaryButton: {borderWidth: 1}, secondaryButtonText: {fontWeight: '700'},
  smallButton: {borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9},
  account: {borderRadius: 10, borderWidth: 1, padding: 16}, accountName: {fontSize: 16, fontWeight: '700', marginBottom: 3},
  buttonText: {color: '#ffffff', fontSize: 16, fontWeight: '700'}, disabled: {opacity: 0.65}, error: {color: '#ed4245', fontSize: 14},
  dangerButton: {paddingVertical: 14}, dangerText: {color: '#ed4245', fontSize: 15, fontWeight: '600'}, cancelButton: {alignItems: 'center', padding: 10},
  updateBackdrop: {alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.68)', flex: 1, justifyContent: 'center', padding: 24},
  updateCard: {borderRadius: 14, borderWidth: 1, maxWidth: 430, padding: 22, width: '100%'},
});

export default App;
