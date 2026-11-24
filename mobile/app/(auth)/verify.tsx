import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorNote, HIT } from '../../src/components/ui';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/lib/theme';
import { messageOf, toApiError } from '../../src/lib/errors';

export default function Verify() {
  const { theme: t } = useTheme();
  const { email } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!/^\d{6,8}$/.test(code)) return setError('Enter the code from your email.');
    setError(''); setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    setBusy(false);
    if (err) setError(/expired|invalid/i.test(err.message) ? 'That code is wrong or has expired. Request a new one.' : messageOf(toApiError(err)));
    // On success the session listener swaps this stack for onboarding or the app.
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: 24, gap: 14 }}>
      <Text onPress={() => router.back()} accessibilityRole="button" style={{ color: t.accent, fontSize: 17, minHeight: HIT, paddingTop: 10 }}>Back</Text>
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 28, fontWeight: '700' }}>Check your inbox</Text>
      <Text style={{ color: t.text2, fontSize: 17 }}>Enter the code we sent to {email}.</Text>
      <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, ''))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={8}
        accessibilityLabel="One-time code" style={{ minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.text, textAlign: 'center', fontSize: 24, letterSpacing: 6 }} />
      {error ? <ErrorNote text={error} /> : null}
      <View style={{ marginTop: 4 }}><Button title="Verify" busy={busy} busyTitle="Verifying" onPress={submit} /></View>
    </SafeAreaView>
  );
}
