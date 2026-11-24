import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorNote } from '../../src/components/ui';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/lib/theme';
import { toApiError, messageOf } from '../../src/lib/errors';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const { theme: t } = useTheme();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) return setError('Enter a valid email address.');
    setError(''); setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) return setError(messageOf(toApiError(err)));
    router.push({ pathname: '/verify', params: { email: e } });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 40, fontWeight: '800', letterSpacing: -1, lineHeight: 42 }}>Meet people{'\n'}near you.</Text>
        <Text style={{ color: t.text2, fontSize: 17 }}>Private one-to-one chats, only after both of you say yes. Adults 18+ only.</Text>
        <View style={{ gap: 6 }}>
          <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={t.text3}
            keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="go" onSubmitEditing={submit}
            accessibilityLabel="Email" style={{ minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14, fontSize: 17 }} />
        </View>
        {error ? <ErrorNote text={error} /> : null}
        <Button title="Send code" busy={busy} busyTitle="Sending" onPress={submit} />
        <Text style={{ color: t.text2, fontSize: 13 }}>We email a one-time code. No passwords.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
