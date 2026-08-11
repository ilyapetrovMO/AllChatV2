/**
 * AllChat Android client foundation.
 *
 * @format
 */

import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
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
import {InstanceAccount, KeychainSessionVault, SessionVault} from './src/session/SessionVault';

const defaultVault = new KeychainSessionVault();

export type AppProps = {vault?: SessionVault};

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
    const name = active.member.display_name || active.member.username;
    return (
      <SafeAreaView style={shellStyle}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <View style={styles.accountHeader}>
          <View style={styles.grow}>
            <Text style={[styles.eyebrow, {color: palette.accent}]}>ACTIVE INSTANCE</Text>
            <Text numberOfLines={1} style={[styles.instanceTitle, {color: palette.text}]}>{instanceName(active.instance_url)}</Text>
            <Text style={[styles.copy, {color: palette.muted}]}>{name} · @{active.member.username}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={() => setAdding(true)} style={[styles.smallButton, {borderColor: palette.border}]}>
            <Text style={{color: palette.text}}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.accountList}>
          <Text style={[styles.sectionTitle, {color: palette.text}]}>Your Instances</Text>
          {accounts.map(account => (
            <TouchableOpacity accessibilityRole="button" key={account.instance_url} onPress={() => setActive(account)} style={[styles.account, {backgroundColor: palette.field, borderColor: account.instance_url === active.instance_url ? palette.accent : palette.border}]}>
              <Text style={[styles.accountName, {color: palette.text}]}>{instanceName(account.instance_url)}</Text>
              <Text style={{color: palette.muted}}>@{account.member.username}</Text>
            </TouchableOpacity>
          ))}
          {status ? <Text style={[styles.notice, {color: palette.muted}]}>{status}</Text> : null}
          <TouchableOpacity accessibilityRole="button" disabled={submitting} onPress={() => signOut(active)} style={styles.dangerButton}>
            <Text style={styles.dangerText}>{submitting ? 'Signing out…' : 'Sign out of this Instance'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
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
        {accounts.length > 0 ? <TouchableOpacity accessibilityRole="button" onPress={() => setAdding(false)} style={styles.cancelButton}><Text style={{color: palette.muted}}>Cancel</Text></TouchableOpacity> : null}
      </View>
    </SafeAreaView>
  );
}

function instanceName(instanceURL: string): string {
  return new URL(instanceURL).host;
}

const darkPalette = {background: '#191a1f', field: '#25272e', border: '#393c46', text: '#f5f6fb', muted: '#aeb2c0', placeholder: '#747988', accent: '#5865f2'};
const lightPalette = {background: '#f4f5f8', field: '#ffffff', border: '#d8dbe4', text: '#171820', muted: '#5e6370', placeholder: '#858a97', accent: '#4752c4'};

const styles = StyleSheet.create({
  screen: {flex: 1}, centered: {alignItems: 'center', flex: 1, justifyContent: 'center'}, grow: {flex: 1},
  form: {flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 14},
  accountHeader: {alignItems: 'center', flexDirection: 'row', gap: 16, padding: 24},
  accountList: {flex: 1, gap: 12, paddingHorizontal: 24},
  eyebrow: {fontSize: 12, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4},
  title: {fontSize: 30, fontWeight: '800', letterSpacing: -0.6}, instanceTitle: {fontSize: 24, fontWeight: '800'}, sectionTitle: {fontSize: 18, fontWeight: '700'},
  copy: {fontSize: 16, lineHeight: 23, marginBottom: 10}, notice: {fontSize: 14, lineHeight: 20},
  input: {borderRadius: 10, borderWidth: 1, fontSize: 16, minHeight: 52, paddingHorizontal: 16},
  button: {alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 52, marginTop: 4},
  smallButton: {borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9},
  account: {borderRadius: 10, borderWidth: 1, padding: 16}, accountName: {fontSize: 16, fontWeight: '700', marginBottom: 3},
  buttonText: {color: '#ffffff', fontSize: 16, fontWeight: '700'}, disabled: {opacity: 0.65}, error: {color: '#ed4245', fontSize: 14},
  dangerButton: {paddingVertical: 14}, dangerText: {color: '#ed4245', fontSize: 15, fontWeight: '600'}, cancelButton: {alignItems: 'center', padding: 10},
});

export default App;
