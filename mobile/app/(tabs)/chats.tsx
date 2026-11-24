import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Badge, Button, EmptyState, ErrorNote, HIT } from '../../src/components/ui';
import { InboxRow } from '../../src/components/rows';
import { useConversations, useRequests } from '../../src/lib/queries';
import { useSignedUrls } from '../../src/lib/signedUrls';
import { useSession } from '../../src/lib/session';
import { useTheme } from '../../src/lib/theme';
import { messageOf } from '../../src/lib/errors';

const ROW_H = 72;

export default function Chats() {
  const { theme: t } = useTheme();
  const me = useSession().session!.user.id;
  const [term, setTerm] = useState('');
  const convos = useConversations();
  const reqs = useRequests();
  useFocusEffect(() => { convos.refetch(); reqs.refetch(); });

  const incoming = (reqs.data ?? []).filter((r) => r.direction === 'incoming');
  const all = convos.data ?? [];
  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q ? all.filter((c) => c.other_name.toLowerCase().includes(q) || (c.last_body ?? '').toLowerCase().includes(q)) : all;
  }, [all, term]);
  const urls = useSignedUrls([...rows.map((r) => r.other_thumb), ...incoming.slice(0, 3).map((r) => r.thumb_key)]);

  const header = (
    <View>
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8, paddingHorizontal: 16, paddingBottom: 10 }}>Chats</Text>
      <View style={{ marginHorizontal: 16, marginBottom: 8, minHeight: HIT, borderRadius: 12, backgroundColor: t.surface2, paddingHorizontal: 12, justifyContent: 'center' }}>
        <TextInput value={term} onChangeText={setTerm} placeholder="Search people and messages" placeholderTextColor={t.text2} accessibilityLabel="Search chats"
          style={{ color: t.text, fontSize: 17, minHeight: HIT }} autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      <Pressable onPress={() => router.push('/requests')} accessibilityRole="button" accessibilityLabel={`Chat requests. ${incoming.length} waiting`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginVertical: 6, padding: 14, minHeight: 64, borderRadius: 16, backgroundColor: t.accentSoft }}>
        <View style={{ flexDirection: 'row' }}>
          {incoming.slice(0, 3).map((r, i) => <View key={r.id} style={{ marginLeft: i ? -12 : 0 }}><Avatar uri={r.thumb_key ? urls[r.thumb_key] : undefined} size={34} /></View>)}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>Chat requests</Text>
          <Text style={{ color: t.text2, fontSize: 15 }}>{incoming.length ? `${incoming.length} waiting for your reply` : 'Nothing new · see sent'}</Text>
        </View>
        <Badge n={incoming.length} label="new requests" />
      </Pressable>
      {convos.isError && !all.length ? <ErrorNote text={messageOf(convos.error)} onRetry={() => convos.refetch()} /> : null}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={rows} keyExtractor={(r) => r.conversation_id} ListHeaderComponent={header}
        renderItem={({ item }) => <InboxRow row={item} me={me} url={item.other_thumb ? urls[item.other_thumb] : undefined} onPress={(id) => router.push(`/chat/${id}`)} />}
        getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
        initialNumToRender={12} windowSize={7} maxToRenderPerBatch={10} removeClippedSubviews keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={convos.isRefetching} onRefresh={() => { void convos.refetch(); }} tintColor={t.accent} />}
        ListEmptyComponent={convos.isPending ? <Text style={{ color: t.text2, padding: 24 }}>Loading chats…</Text> : term ? <Text style={{ color: t.text2, padding: 24 }}>No chats match “{term}”.</Text>
          : <EmptyState title="No conversations yet" body="Send a request to someone nearby. When they accept, your chat lands here." action={<Button title="Find people nearby" onPress={() => router.navigate('/nearby')} />} />}
      />
    </SafeAreaView>
  );
}
