import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorNote, HIT } from '../src/components/ui';
import { Choice, Field, TagPicker } from '../src/components/form';
import { PhotoGrid, type Slot } from '../src/components/PhotoGrid';
import { api } from '../src/lib/api';
import { MAX_TAGS, PROMPTS, TAGS } from '../src/lib/content';
import { MAX_PHOTOS, pickPhoto, uploadPhoto } from '../src/lib/photos';
import { useSession } from '../src/lib/session';
import { useSignedUrls } from '../src/lib/signedUrls';
import { useTheme } from '../src/lib/theme';
import { messageOf } from '../src/lib/errors';
import type { Prompt } from '../src/lib/types';

export default function EditProfile() {
  const { theme: t } = useTheme();
  const { profile, session, refreshProfile } = useSession();
  const p = profile!;
  const qc = useQueryClient();
  const urls = useSignedUrls(p.photos.map((x) => x.object_key));
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.cities, staleTime: Infinity });
  const [name, setName] = useState(p.name);
  const [bio, setBio] = useState(p.bio);
  const [cityId, setCityId] = useState(p.city_id);
  const [tags, setTags] = useState(p.tags);
  const [prompts, setPrompts] = useState<Prompt[]>([0, 1, 2].map((i) => p.prompts[i] ?? { q: PROMPTS[i], a: '' }));
  // Existing photos use their signed URLs until saved; new ones use the local file.
  const [slots, setSlots] = useState<(Slot & { stored?: { object_key: string; thumb_key: string } })[]>(
    p.photos.map((x) => ({ key: x.object_key, uri: urls[x.object_key] ?? '', isNew: false, stored: x })));
  const [showCities, setShowCities] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const shown = slots.map((s) => (s.stored && !s.uri ? { ...s, uri: urls[s.stored.object_key] ?? '' } : s));

  async function add() {
    try { const uri = await pickPhoto(); if (uri) setSlots((s) => [...s, { key: uri, uri, isNew: true }].slice(0, MAX_PHOTOS)); }
    catch { setError('We could not open your photos. Check Photos access in Settings.'); }
  }

  async function save() {
    if (!name.trim()) return setError('Add your name.');
    if (!slots.length) return setError('Keep at least one photo.');
    setBusy(true); setError('');
    try {
      // Upload new files first; the profile only changes once every upload has succeeded.
      const photos = await Promise.all(slots.map((s) => (s.stored ? Promise.resolve(s.stored) : uploadPhoto(session!.user.id, s.uri))));
      await api.updateProfile({ name: name.trim(), bio: bio.trim(), cityId, tags, prompts: prompts.filter((x) => x.a.trim()).map((x) => ({ q: x.q, a: x.a.trim() })), discoverable: p.discoverable });
      await api.setPhotos(photos);
      refreshProfile(); qc.invalidateQueries({ queryKey: ['profile'] });
      router.back();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 8 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel" style={{ minWidth: HIT, minHeight: HIT, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ color: t.accent, fontSize: 17 }}>Cancel</Text></Pressable>
        <Text accessibilityRole="header" style={{ flex: 1, textAlign: 'center', color: t.text, fontSize: 17, fontWeight: '600' }}>Edit profile</Text>
        <Pressable onPress={save} disabled={busy} accessibilityRole="button" accessibilityLabel="Save" style={{ minWidth: HIT, minHeight: HIT, justifyContent: 'center', paddingHorizontal: 8 }}><Text style={{ color: t.accent, fontSize: 17, fontWeight: '700', opacity: busy ? 0.5 : 1 }}>{busy ? 'Saving' : 'Save'}</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>Photos · {slots.length}/{MAX_PHOTOS} · first is your main</Text>
        <PhotoGrid slots={shown} onAdd={add} onRemove={(i) => setSlots((s) => s.filter((_, k) => k !== i))}
          onMove={(i, d) => setSlots((s) => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; })} />
        {error ? <ErrorNote text={error} /> : null}
        <Field label="Name" value={name} onChangeText={setName} maxLength={30} />
        <Field label="Bio" hint={`${bio.length}/160`} value={bio} onChangeText={setBio} maxLength={160} multiline />
        <View style={{ gap: 6 }}>
          <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>City</Text>
          <Pressable onPress={() => setShowCities(!showCities)} accessibilityRole="button" style={{ minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, paddingHorizontal: 14, justifyContent: 'center' }}>
            <Text style={{ color: t.text, fontSize: 17 }}>{cities.data?.find((c) => c.id === cityId)?.name ?? p.city} ⌄</Text>
          </Pressable>
          {showCities ? <View style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: t.surface }}>{(cities.data ?? []).map((c) => <Choice key={c.id} title={c.name} selected={c.id === cityId} onPress={() => { setCityId(c.id); setShowCities(false); }} />)}</View> : null}
        </View>
        <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>Interests · {tags.length}/{MAX_TAGS}</Text>
        <TagPicker all={TAGS} value={tags} max={MAX_TAGS} onChange={setTags} />
        <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>Prompts · people can reply to these</Text>
        {prompts.map((pr, i) => (
          <View key={i} style={{ gap: 6 }}>
            <Pressable onPress={() => setPrompts((l) => l.map((x, k) => (k === i ? { ...x, q: PROMPTS[(PROMPTS.indexOf(x.q) + 1) % PROMPTS.length] } : x)))}
              accessibilityRole="button" accessibilityLabel={`Prompt ${i + 1}: ${pr.q}. Tap to change question`} style={{ minHeight: HIT, justifyContent: 'center' }}>
              <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>{pr.q} ↻</Text>
            </Pressable>
            <Field label={`Answer ${i + 1}`} value={pr.a} onChangeText={(v) => setPrompts((l) => l.map((x, k) => (k === i ? { ...x, a: v } : x)))} maxLength={120} multiline />
          </View>
        ))}
        <Button title="Save changes" busy={busy} busyTitle="Saving" onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
