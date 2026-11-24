import { useRef, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorNote, HIT } from '../../src/components/ui';
import { Field } from '../../src/components/form';
import { api } from '../../src/lib/api';
import { ApiError, messageOf } from '../../src/lib/errors';
import { useSession } from '../../src/lib/session';
import { useSignedUrls } from '../../src/lib/signedUrls';
import { useTheme } from '../../src/lib/theme';

export default function UserProfile() {
  const { theme: t } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession().session!.user.id;
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const q = useQuery({ queryKey: ['profile', id], queryFn: () => api.getProfile(id), retry: (n, e) => !(e instanceof ApiError && e.code === 'not_found') && n < 1 });
  const p = q.data;
  const urls = useSignedUrls((p?.photos ?? []).map((x) => x.object_key));
  const [note, setNote] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const noteRef = useRef<{ focus: () => void } | null>(null);

  if (q.isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={{ width: HIT, height: HIT, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: t.text, fontSize: 28 }}>‹</Text></Pressable>
        <EmptyState title="This profile isn’t available" body={messageOf(q.error)} action={<Button title="Go back" onPress={() => router.back()} />} />
      </SafeAreaView>
    );
  }
  if (!p) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}><Text style={{ color: t.text2, padding: 24 }}>Loading profile…</Text></SafeAreaView>;

  const isMe = p.id === me;
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['requests'] })]); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  const send = () => act(() => api.sendRequest(p.id, note.trim() || undefined, note.trim() && prompt ? prompt : undefined));
  const confirmBlock = () => Alert.alert(`Block ${p.name}?`, 'They can’t message you or see your photos. Your chat closes for both of you. They aren’t told.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Block', style: 'destructive', onPress: async () => { try { await api.block(p.id); await qc.invalidateQueries(); router.back(); } catch (e) { setError(messageOf(e)); } } },
  ]);

  let cta;
  if (isMe) cta = <Button title="Edit profile" onPress={() => router.push('/edit-profile')} />;
  else if (p.relation === 'connected') cta = <Button title="Open chat" onPress={() => router.push(`/chat/${p.conversation_id}`)} />;
  else if (p.relation === 'request_sent') cta = <><Button title="✓ Request sent" kind="soft" disabled onPress={() => {}} /><Button title="Cancel request" kind="ghost" busy={busy} busyTitle="Cancelling" small onPress={() => act(() => api.cancelRequest(p.request_id!))} /></>;
  else if (p.relation === 'request_received') cta = <Button title="Review request" onPress={() => router.push('/requests')} />;
  else cta = <Button title="Send request" busy={busy} busyTitle="Sending" onPress={send} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 150 }} keyboardShouldPersistTaps="handled">
        <View>
          <FlatList data={p.photos} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={(x) => x.object_key}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item, index }) => <Image source={urls[item.object_key] ? { uri: urls[item.object_key] } : undefined} style={{ width, aspectRatio: 4 / 5, backgroundColor: t.surface2 }} contentFit="cover"
              accessibilityLabel={`${p.name}, photo ${index + 1} of ${p.photos.length}`} />}
            ListEmptyComponent={<View style={{ width, aspectRatio: 4 / 5, backgroundColor: t.surface2 }} />} />
          <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }} pointerEvents="box-none">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12 }} pointerEvents="box-none">
              <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={{ width: HIT, height: HIT, borderRadius: 22, backgroundColor: 'rgba(20,14,34,0.55)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 26 }}>‹</Text></Pressable>
              {!isMe ? <Pressable onPress={confirmBlock} accessibilityRole="button" accessibilityLabel={`Block ${p.name}`} style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(20,14,34,0.55)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '600' }}>Block</Text></Pressable> : null}
            </View>
          </SafeAreaView>
          {p.photos.length > 1 ? <View style={{ position: 'absolute', bottom: 40, alignSelf: 'center', flexDirection: 'row', gap: 6 }}>{p.photos.map((_, i) => <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === page ? '#fff' : 'rgba(255,255,255,0.5)' }} />)}</View> : null}
        </View>
        <View style={{ marginTop: -26, backgroundColor: t.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 12 }}>
          <View>
            <Text accessibilityRole="header" style={{ color: t.text, fontSize: 28, fontWeight: '800' }}>{p.name}, {p.age}</Text>
            <Text style={{ color: t.text2, fontSize: 15 }}>{p.city}</Text>
          </View>
          {p.tonight ? <View style={{ backgroundColor: t.accent, borderRadius: 16, padding: 14 }}><Text style={{ color: t.onAccent, fontSize: 17, fontWeight: '700' }}>Tonight: {p.tonight.text}</Text>{p.tonight.area ? <Text style={{ color: t.onAccent, fontSize: 13, opacity: 0.9 }}>{p.tonight.area}</Text> : null}</View> : null}
          {p.bio ? <Text style={{ color: t.text, fontSize: 17 }}>{p.bio}</Text> : null}
          {p.tags.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{p.tags.map((x) => <View key={x} style={{ paddingHorizontal: 12, minHeight: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.border }}><Text style={{ color: t.text, fontSize: 15 }}>{x}</Text></View>)}</View> : null}
          {p.prompts.map((pr) => (
            <View key={pr.q} style={{ backgroundColor: t.surface, borderRadius: 18, padding: 16, gap: 4, borderWidth: 1, borderColor: t.border }}>
              <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>{pr.q}</Text>
              <Text style={{ color: t.text, fontSize: 20, fontWeight: '500' }}>{pr.a}</Text>
              {p.relation === 'none' ? <Pressable onPress={() => { setPrompt(pr.q); noteRef.current?.focus(); }} accessibilityRole="button" accessibilityLabel={`Reply to ${pr.q}`}
                style={{ alignSelf: 'flex-start', minHeight: HIT, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, backgroundColor: prompt === pr.q ? t.accent : t.accentSoft }}>
                <Text style={{ color: prompt === pr.q ? t.onAccent : t.accentInk, fontWeight: '600' }}>{prompt === pr.q ? 'Replying' : 'Reply'}</Text></Pressable> : null}
            </View>
          ))}
          {p.relation === 'none' ? <Field label={prompt ? `Your reply to “${prompt}”` : 'Add a note (optional)'} hint={`${note.length}/200`} value={note} onChangeText={setNote} maxLength={200} multiline placeholder="Say something specific to them…" /> : null}
          {error ? <ErrorNote text={error} /> : null}
        </View>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: t.surface, borderTopWidth: 0.5, borderTopColor: t.border, padding: 12, gap: 6 }}>{cta}</SafeAreaView>
    </View>
  );
}
