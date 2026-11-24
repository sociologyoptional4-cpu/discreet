import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorNote, HIT } from '../src/components/ui';
import { RequestRow } from '../src/components/rows';
import { api } from '../src/lib/api';
import { useRequests } from '../src/lib/queries';
import { useSignedUrls } from '../src/lib/signedUrls';
import { useTheme } from '../src/lib/theme';
import { messageOf } from '../src/lib/errors';

export default function Requests() {
  const { theme: t } = useTheme();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'incoming' | 'sent'>('incoming');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const q = useRequests();
  const all = q.data ?? [];
  const items = all.filter((r) => r.direction === tab);
  const urls = useSignedUrls(items.map((r) => r.thumb_key));
  const count = (d: string) => all.filter((r) => r.direction === d).length;

  async function run(id: string, fn: () => Promise<unknown>, then?: (r: unknown) => void) {
    setBusy(id); setError('');
    try { const r = await fn(); await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['conversations'] })]); then?.(r); }
    catch (e) { setError(messageOf(e)); await q.refetch(); }
    finally { setBusy(null); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 8 }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.text, fontSize: 28 }}>‹</Text></Pressable>
        <Text accessibilityRole="header" style={{ flex: 1, textAlign: 'center', color: t.text, fontSize: 17, fontWeight: '600' }}>Chat requests</Text>
        <View style={{ width: HIT }} />
      </View>
      <View style={{ flexDirection: 'row', margin: 16, padding: 3, borderRadius: 12, backgroundColor: t.surface2 }} accessibilityRole="tablist">
        {(['incoming', 'sent'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}
            style={{ flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === k ? t.surface : 'transparent' }}>
            <Text style={{ color: tab === k ? t.text : t.text2, fontWeight: '600', fontSize: 15 }}>{k === 'incoming' ? 'Incoming' : 'Sent'}{count(k) ? ` · ${count(k)}` : ''}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <ErrorNote text={error} /> : null}
      <FlatList data={items} keyExtractor={(r) => r.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }} onRefresh={() => q.refetch()} refreshing={q.isRefetching}
        renderItem={({ item }) => (
          <RequestRow item={item} url={item.thumb_key ? urls[item.thumb_key] : undefined} busy={busy === item.id}
            onOpen={(id) => router.push(`/user/${id}`)}
            onAccept={(id) => run(id, () => api.respond(id, true), (cid) => cid && router.replace(`/chat/${cid}`))}
            onDecline={(id) => run(id, () => api.respond(id, false))}
            onCancel={(id) => run(id, () => api.cancelRequest(id))} />
        )}
        ListEmptyComponent={q.isPending ? undefined : tab === 'incoming'
          ? <EmptyState title="No requests right now" body="When someone nearby wants to chat, you review it here first. Nothing opens without your yes." action={<Button title="Browse Nearby" onPress={() => router.replace('/nearby')} />} />
          : <EmptyState title="Nothing sent yet" body="Reply to someone’s prompt on Nearby. Requests with a reason get answered more." />} />
    </SafeAreaView>
  );
}
