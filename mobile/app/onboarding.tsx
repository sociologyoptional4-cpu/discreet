import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Button, ErrorNote, HIT } from '../src/components/ui';
import { Choice, Field, TagPicker } from '../src/components/form';
import { PhotoGrid, type Slot } from '../src/components/PhotoGrid';
import { api } from '../src/lib/api';
import { isAdult, toDateOnly } from '../src/lib/age';
import { MAX_TAGS, MIN_TAGS, TAGS } from '../src/lib/content';
import { pickPhoto, uploadPhoto, MAX_PHOTOS } from '../src/lib/photos';
import { useSession } from '../src/lib/session';
import { useTheme } from '../src/lib/theme';
import { messageOf } from '../src/lib/errors';
import { supabase } from '../src/lib/supabase';

const STEPS = ['about', 'vibe', 'city', 'photos'] as const;
const DEFAULT_DOB = new Date(new Date().getFullYear() - 25, 0, 1);

export default function Onboarding() {
  const { theme: t } = useTheme();
  const { session, refreshProfile, signOut } = useSession();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [dob, setDob] = useState<Date | null>(null);
  const [bio, setBio] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.cities, staleTime: Infinity });

  const uid = session!.user.id;
  const valid = [
    name.trim().length > 0 && !!dob,
    tags.length >= MIN_TAGS,
    cityId !== null,
    slots.length > 0,
  ][step];

  async function add() {
    try { const uri = await pickPhoto(); if (uri) setSlots((s) => [...s, { key: uri, uri, isNew: true }].slice(0, MAX_PHOTOS)); }
    catch { setError('We could not open your photos. Check Photos access in Settings.'); }
  }

  async function next() {
    setError('');
    if (step === 0 && dob && !isAdult(dob)) return setError('Nearby Chat is for adults 18 and over.');
    if (step < STEPS.length - 1) return setStep(step + 1);
    setBusy(true);
    try {
      await api.createProfile({ name: name.trim(), dob: toDateOnly(dob!), cityId: cityId!, bio: bio.trim(), tags });
      const uploaded = await Promise.all(slots.map((s) => uploadPhoto(uid, s.uri)));
      await api.setPhotos(uploaded);
      refreshProfile(); // the navigation guard now moves to the app
    } catch (e) {
      setError(messageOf(e));
      // A profile may exist already (e.g. photo upload failed): let the user retry safely.
      refreshProfile();
    } finally { setBusy(false); }
  }

  const titles = ['Introduce yourself', 'Pick your vibe', 'Where are you?', 'Add your photos'];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        <Pressable onPress={() => (step ? setStep(step - 1) : signOut())} accessibilityRole="button" accessibilityLabel={step ? 'Back' : 'Sign out'} style={{ width: HIT, height: HIT, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: t.text, fontSize: 24 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1, flexDirection: 'row', gap: 4, paddingHorizontal: 8 }} accessible accessibilityRole="progressbar" accessibilityLabel={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((_, i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? t.accent : t.surface2 }} />)}
        </View>
        <View style={{ width: HIT }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 28, fontWeight: '700' }}>{titles[step]}</Text>
          {step === 0 ? (<>
            <Field label="First name" value={name} onChangeText={setName} maxLength={30} autoComplete="given-name" textContentType="givenName" />
            <View style={{ gap: 6 }}>
              <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>Date of birth</Text>
              <Text style={{ color: t.text2, fontSize: 15 }}>Adults 18+ only. Others see your age, never your birthday.</Text>
              <DateTimePicker value={dob ?? DEFAULT_DOB} mode="date" display="spinner" maximumDate={new Date()} themeVariant={t.dark ? 'dark' : 'light'}
                onChange={(_, d) => d && setDob(d)} accessibilityLabel="Date of birth" />
              {!dob ? <Button title="Use this date" kind="soft" onPress={() => setDob(DEFAULT_DOB)} /> : null}
            </View>
            <Field label="Short bio" hint={`${bio.length}/160`} value={bio} onChangeText={setBio} maxLength={160} multiline placeholder="What would you talk about for hours?" />
          </>) : null}
          {step === 1 ? (<>
            <Text style={{ color: t.text2, fontSize: 17 }}>Choose {MIN_TAGS} to {MAX_TAGS}. People who share them see a spark on your card.</Text>
            <TagPicker all={TAGS} value={tags} max={MAX_TAGS} onChange={setTags} />
          </>) : null}
          {step === 2 ? (<>
            <Text style={{ color: t.text2, fontSize: 17 }}>Nearby shows people in your city. Distance is optional and approximate; you can turn it on later in Profile.</Text>
            <View style={{ backgroundColor: t.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 0.5, borderColor: t.border }} accessibilityRole="radiogroup">
              {(cities.data ?? []).map((c) => <Choice key={c.id} title={c.name} selected={cityId === c.id} onPress={() => setCityId(c.id)} />)}
            </View>
            {cities.isError ? <ErrorNote text="Could not load cities." onRetry={() => cities.refetch()} /> : null}
          </>) : null}
          {step === 3 ? (<>
            <Text style={{ color: t.text2, fontSize: 17 }}>Up to four. Your first photo is your main one. We re-encode photos and remove location data before upload.</Text>
            <PhotoGrid slots={slots} onAdd={add}
              onRemove={(i) => setSlots((s) => s.filter((_, k) => k !== i))}
              onMove={(i, d) => setSlots((s) => { const n = [...s]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; })} />
          </>) : null}
          {error ? <ErrorNote text={error} /> : null}
          <Button title={step === STEPS.length - 1 ? 'Finish' : 'Continue'} disabled={!valid} busy={busy} busyTitle="Saving" onPress={next} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
