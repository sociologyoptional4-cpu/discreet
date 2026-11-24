import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, ErrorNote, HIT } from '../../src/components/ui';
import { MessageBubble } from '../../src/components/rows';
import { api } from '../../src/lib/api';
import { useConversations } from '../../src/lib/queries';
import { useSession } from '../../src/lib/session';
import { useSignedUrls } from '../../src/lib/signedUrls';
import { useThread, type ThreadItem } from '../../src/lib/useThread';
import { useTheme } from '../../src/lib/theme';
import { messageOf } from '../../src/lib/errors';

const clock = (iso: string | number) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function Chat() {
  const { theme: t } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSession().session!.user.id;
  const qc = useQueryClient();
  const convos = useConversations(false);
  const row = convos.data?.find((c) => c.conversation_id === id);
  const urls = useSignedUrls([row?.other_thumb]);
  const th = useThread(id, me);
  const [draft, setDraft] = useState('');
  const [away, setAway] = useState(false);            // scrolled up reading older messages
  const [newBelow, setNewBelow] = useState(false);
  const list = useRef<FlatList<ThreadItem>>(null);
  const unreadAtOpen = useRef<number | null>(null);
  if (unreadAtOpen.current === null && row) unreadAtOpen.current = row.unread;
  const topSeq = useRef(0);

  // Sequence of the oldest unread message from them, captured once so the divider doesn't move while reading.
  const dividerSeq = useMemo(() => {
    const n = unreadAtOpen.current ?? 0;
    if (!n) return null;
    const theirs = th.items.filter((i): i is Extract<ThreadItem, { kind: 'server' }> => i.kind === 'server' && i.m.sender_id !== me);
    return theirs[n - 1]?.m.seq ?? null;
  }, [th.items, me]);

  // Read cursor only advances while the newest message is on screen.
  useEffect(() => {
    if (th.maxSeq && !away) api.markRead(id, th.maxSeq).then(() => qc.invalidateQueries({ queryKey: ['conversations'] })).catch(() => {});
  }, [th.maxSeq, away, id, qc]);

  useEffect(() => {
    const newest = th.items.find((i) => i.kind === 'server');
    if (newest && newest.kind === 'server' && newest.m.seq > topSeq.current) {
      if (topSeq.current && away && newest.m.sender_id !== me) setNewBelow(true);
      topSeq.current = newest.m.seq;
    }
  }, [th.items, away, me]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const far = e.nativeEvent.contentOffset.y > 120;
    setAway(far);
    if (!far) setNewBelow(false);
  };

  function submit() {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    th.send(body);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }

  const blocked = th.unavailable || row?.unavailable;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: 8, backgroundColor: t.bg, borderBottomWidth: 0.5, borderBottomColor: t.border }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to chats" style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: t.text, fontSize: 28 }}>‹</Text></Pressable>
        <Pressable disabled={!row || !!blocked} onPress={() => row && router.push(`/user/${row.other_id}`)} accessibilityRole="button" accessibilityLabel={`${row?.other_name ?? 'Chat'}, open profile`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minHeight: HIT }}>
          <Avatar uri={row?.other_thumb ? urls[row.other_thumb] : undefined} size={38} />
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 17, fontWeight: '600', flex: 1 }}>{row?.other_name ?? ''}</Text>
        </Pressable>
      </View>
      {th.offline ? <ErrorNote text="You’re offline. We’ll catch up when you reconnect." /> : null}
      {th.error && !th.unavailable && !th.items.length ? <ErrorNote text={messageOf(th.error)} onRetry={() => th.refetch()} /> : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <FlatList
          ref={list} inverted data={th.items} keyExtractor={(i) => i.key} onScroll={onScroll} scrollEventThrottle={64}
          keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingVertical: 8 }}
          initialNumToRender={20} windowSize={9} maxToRenderPerBatch={12}
          onEndReached={th.loadOlder} onEndReachedThreshold={0.4}
          ListFooterComponent={th.hasOlder ? <Text style={{ color: t.text2, textAlign: 'center', padding: 12 }}>Loading earlier messages…</Text> : undefined}
          ListEmptyComponent={th.loading ? undefined : <Text style={{ color: t.text2, textAlign: 'center', padding: 32, transform: [{ scaleY: -1 }] }}>You’re connected. Say hello.</Text>}
          renderItem={({ item, index }) => {
            const newerSameSender = th.items[index - 1];
            const mine = item.kind === 'pending' ? true : item.m.sender_id === me;
            const firstOfRun = !newerSameSender || (newerSameSender.kind === 'pending' ? true : newerSameSender.m.sender_id === me) !== mine;
            const isLatestMine = mine && th.items.findIndex((i) => (i.kind === 'pending') || i.m.sender_id === me) === index;
            const divider = item.kind === 'server' && dividerSeq === item.m.seq;
            return (
              <View>
                {divider ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginVertical: 10 }}><View style={{ flex: 1, height: 1.5, backgroundColor: t.unread }} /><Text style={{ color: t.text, fontSize: 13, fontWeight: '700' }}>New messages</Text><View style={{ flex: 1, height: 1.5, backgroundColor: t.unread }} /></View> : null}
                {item.kind === 'pending'
                  ? <MessageBubble body={item.p.body} mine status={item.p.status} time={clock(item.p.at)} showStatus onRetry={() => th.retry(item.p.clientId)} />
                  : <MessageBubble body={item.m.body} mine={mine} status="sent" time={clock(item.m.created_at)} showStatus={isLatestMine || firstOfRun} />}
              </View>
            );
          }}
        />
        {newBelow ? (
          <Pressable onPress={() => { list.current?.scrollToOffset({ offset: 0, animated: true }); setNewBelow(false); }} accessibilityRole="button" accessibilityLabel="Jump to new messages"
            style={{ position: 'absolute', alignSelf: 'center', bottom: 76, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: t.accent, justifyContent: 'center' }}>
            <Text style={{ color: t.onAccent, fontWeight: '600' }}>↓ New messages</Text>
          </Pressable>
        ) : null}
        {blocked ? (
          <View style={{ padding: 16, paddingBottom: 28, backgroundColor: t.errorSoft }} accessibilityRole="alert">
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>This conversation is unavailable</Text>
            <Text style={{ color: t.text2, fontSize: 15 }}>You can no longer send or read messages here.</Text>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, paddingBottom: 12, backgroundColor: t.surface, borderTopWidth: 0.5, borderTopColor: t.border }}>
            <TextInput value={draft} onChangeText={setDraft} placeholder="Message" placeholderTextColor={t.text2} multiline maxLength={1000} accessibilityLabel="Message"
              style={{ flex: 1, maxHeight: 120, minHeight: HIT, borderRadius: 22, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 17 }} />
            <Pressable onPress={submit} disabled={!draft.trim()} accessibilityRole="button" accessibilityLabel="Send"
              style={{ width: HIT, height: HIT, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: draft.trim() ? t.accent : t.surface2 }}>
              <Text style={{ color: draft.trim() ? t.onAccent : t.text3, fontSize: 22, fontWeight: '700' }}>↑</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
