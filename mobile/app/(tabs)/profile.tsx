import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNote, HIT } from '../../src/components/ui';
import { Field } from '../../src/components/form';
import { api } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { useSignedUrls } from '../../src/lib/signedUrls';
import { useTheme, type Pref } from '../../src/lib/theme';
import { messageOf } from '../../src/lib/errors';
import { Image } from 'expo-image';

const Row = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => {
  const { theme: t } = useTheme();
  return (
    <View style={{ minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderBottomColor: t.border }}>
      <View style={{ flex: 1 }}><Text style={{ color: t.text, fontSize: 17 }}>{title}</Text>{sub ? <Text style={{ color: t.text2, fontSize: 13 }}>{sub}</Text> : null}</View>{children}
    </View>
  );
};

export default function Profile() {
  const { theme: t, pref, setPref } = useTheme();
  const { profile, refreshProfile, signOut } = useSession();
  const qc = useQueryClient();
  const p = profile!;
  const urls = useSignedUrls(p.photos.map((x) => x.object_key));
  const [tonight, setTonight] = useState(p.tonight?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.cities, staleTime: Infinity });
  void cities;

  async function toggleDiscovery(v: boolean) {
    setError('');
    try {
      await api.updateProfile({ name: p.name, bio: p.bio, cityId: p.city_id, tags: p.tags, prompts: p.prompts, discoverable: v });
      refreshProfile(); qc.invalidateQueries({ queryKey: ['nearby'] });
    } catch (e) { setError(messageOf(e)); }
  }
  async function postTonight(clear = false) {
    setBusy(true); setError('');
    try { await api.setTonight(clear ? null : tonight.trim() || null); if (clear) setTonight(''); refreshProfile(); qc.invalidateQueries({ queryKey: ['nearby'] }); }
    catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8, paddingHorizontal: 16, paddingBottom: 10 }}>Profile</Text>
        <View style={{ flexDirection: 'row', gap: 16, margin: 16, marginTop: 4, padding: 14, borderRadius: 20, backgroundColor: t.surface, borderWidth: 0.5, borderColor: t.border }}>
          <Pressable onPress={() => router.push(`/user/${p.id}`)} accessibilityRole="button" accessibilityLabel="Preview my profile">
            <Image source={p.photos[0] && urls[p.photos[0].object_key] ? { uri: urls[p.photos[0].object_key] } : undefined} style={{ width: 88, height: 112, borderRadius: 14, backgroundColor: t.surface2 }} contentFit="cover" />
          </Pressable>
          <View style={{ flex: 1, gap: 8 }}>
            <View><Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>{p.name}, {p.age}</Text><Text style={{ color: t.text2 }}>{p.city}</Text></View>
            <Button title="Edit profile" small onPress={() => router.push('/edit-profile')} />
          </View>
        </View>
        {error ? <ErrorNote text={error} /> : null}
        <View style={{ marginHorizontal: 16, gap: 8 }}>
          <Field label="Tonight" hint={p.tonight ? 'Live for 24 hours' : 'Optional'} value={tonight} onChangeText={setTonight} maxLength={40} placeholder="Free for filter coffee in Indiranagar" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={p.tonight ? 'Update' : 'Post for 24 hours'} small busy={busy} onPress={() => postTonight()} disabled={!tonight.trim()} /></View>
            {p.tonight ? <View style={{ flex: 1 }}><Button title="Remove" kind="ghost" small onPress={() => postTonight(true)} /></View> : null}
          </View>
        </View>
        <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600', margin: 16, marginBottom: 6 }}>Appearance</Text>
        <View style={{ marginHorizontal: 16, flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: t.surface2 }} accessibilityRole="radiogroup">
          {(['system', 'light', 'dark'] as Pref[]).map((k) => (
            <Pressable key={k} onPress={() => setPref(k)} accessibilityRole="radio" accessibilityState={{ selected: pref === k }} style={{ flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: pref === k ? t.surface : 'transparent' }}>
              <Text style={{ color: pref === k ? t.text : t.text2, fontWeight: '600', textTransform: 'capitalize' }}>{k}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600', margin: 16, marginBottom: 6 }}>Discovery</Text>
        <View style={{ marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: t.surface, borderWidth: 0.5, borderColor: t.border }}>
          <Row title="Show me on Nearby" sub={p.discoverable ? 'People in your city can find you' : 'Paused — existing chats continue'}>
            <Switch value={p.discoverable} onValueChange={toggleDiscovery} accessibilityLabel="Show me on Nearby" trackColor={{ true: t.accent }} />
          </Row>
          <Row title="Approximate location" sub="Arrives in the next phase"><Switch value={false} disabled accessibilityLabel="Approximate location, not available yet" /></Row>
        </View>
        <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600', margin: 16, marginBottom: 6 }}>Account</Text>
        <View style={{ marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: t.surface, borderWidth: 0.5, borderColor: t.border }}>
          <Pressable onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: signOut }])} accessibilityRole="button" style={{ minHeight: HIT + 8, justifyContent: 'center', paddingHorizontal: 16 }}>
            <Text style={{ color: t.text, fontSize: 17 }}>Sign out</Text>
          </Pressable>
        </View>
        <Text style={{ color: t.text2, fontSize: 13, padding: 16 }}>Reporting, blocked accounts and account deletion arrive in Phase 3.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
