/**
 * AllChat Android client foundation.
 *
 * @format
 */

import React, {useMemo, useState} from 'react';
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

import {AllChatClient, NativeSession} from './src/client/AllChatClient';
import {normalizeInstanceURL} from './src/domain/instance';

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent(): React.JSX.Element {
  const dark = useColorScheme() !== 'light';
  const [instanceInput, setInstanceInput] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<NativeSession>();
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const palette = useMemo(() => (dark ? darkPalette : lightPalette), [dark]);

  async function signIn() {
    setSubmitting(true);
    setStatus('');
    try {
      const instanceURL = normalizeInstanceURL(instanceInput, __DEV__);
      const client = new AllChatClient(instanceURL);
      setSession(await client.login(username, password, 'AllChat Android'));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  if (session) {
    const name = session.member.display_name || session.member.username;
    return (
      <SafeAreaView style={[styles.screen, {backgroundColor: palette.background}]}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
        <View style={styles.centered}>
          <Text style={[styles.eyebrow, {color: palette.accent}]}>ALLCHAT MOBILE</Text>
          <Text style={[styles.title, {color: palette.text}]}>Welcome, {name}</Text>
          <Text style={[styles.copy, {color: palette.muted}]}>
            Native Session established. Community synchronization is the next milestone.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, {backgroundColor: palette.background}]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={styles.form}>
        <Text style={[styles.eyebrow, {color: palette.accent}]}>ALLCHAT MOBILE</Text>
        <Text style={[styles.title, {color: palette.text}]}>Add an Instance</Text>
        <Text style={[styles.copy, {color: palette.muted}]}>
          Sign in with the address and Member account for your Community.
        </Text>
        <TextInput
          accessibilityLabel="Instance address"
          autoCapitalize="none"
          autoCorrect={false}
          inputMode="url"
          onChangeText={setInstanceInput}
          placeholder="https://chat.example.com"
          placeholderTextColor={palette.placeholder}
          style={[styles.input, {backgroundColor: palette.field, borderColor: palette.border, color: palette.text}]}
          value={instanceInput}
        />
        <TextInput
          accessibilityLabel="Username"
          autoCapitalize="none"
          autoComplete="username"
          onChangeText={setUsername}
          placeholder="Username"
          placeholderTextColor={palette.placeholder}
          style={[styles.input, {backgroundColor: palette.field, borderColor: palette.border, color: palette.text}]}
          value={username}
        />
        <TextInput
          accessibilityLabel="Password"
          autoComplete="current-password"
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={palette.placeholder}
          secureTextEntry
          style={[styles.input, {backgroundColor: palette.field, borderColor: palette.border, color: palette.text}]}
          value={password}
        />
        {status ? <Text style={styles.error}>{status}</Text> : null}
        <TouchableOpacity
          accessibilityRole="button"
          disabled={submitting}
          onPress={signIn}
          style={[styles.button, {backgroundColor: palette.accent}, submitting && styles.disabled]}>
          {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const darkPalette = {
  background: '#191a1f', field: '#25272e', border: '#393c46', text: '#f5f6fb', muted: '#aeb2c0', placeholder: '#747988', accent: '#5865f2',
};

const lightPalette = {
  background: '#f4f5f8', field: '#ffffff', border: '#d8dbe4', text: '#171820', muted: '#5e6370', placeholder: '#858a97', accent: '#4752c4',
};

const styles = StyleSheet.create({
  screen: {flex: 1},
  form: {flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 14},
  centered: {flex: 1, justifyContent: 'center', paddingHorizontal: 28},
  eyebrow: {fontSize: 12, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4},
  title: {fontSize: 30, fontWeight: '800', letterSpacing: -0.6},
  copy: {fontSize: 16, lineHeight: 23, marginBottom: 10},
  input: {borderRadius: 10, borderWidth: 1, fontSize: 16, minHeight: 52, paddingHorizontal: 16},
  button: {alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 52, marginTop: 4},
  buttonText: {color: '#ffffff', fontSize: 16, fontWeight: '700'},
  disabled: {opacity: 0.65},
  error: {color: '#ed4245', fontSize: 14},
});

export default App;
