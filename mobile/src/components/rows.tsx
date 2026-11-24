import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Avatar, Badge, Button } from './ui';
import { useTheme } from '../lib/theme';
import type { ConversationRow, MessageRow, NearbyRow, RequestItem } from '../lib/types';

export const timeLabel = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso); const diff = Date.now() - d.getTime();
  if (diff < 60e3) return 'now';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m`;
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff < 7 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

// Rows are memoised: one conversation changing re-renders only that row.
export const InboxRow = memo(function InboxRow({ row, me, url, onPress }: { row: ConversationRow; me: string; url?: string; onPress: (id: string) => void }) {
  const { theme: t } = useTheme();
  const preview = row.last_body ? (row.last_sender === me ? `You: ${row.last_body}` : row.last_body) : 'Say hello';
  return (
    <Pressable onPress={() => onPress(row.conversation_id)} accessibilityRole="button"
      accessibilityLabel={`${row.other_name}. ${row.unread ? `${row.unread} unread. ` : ''}${row.unavailable ? 'Unavailable. ' : preview}`}
      style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.surface : 'transparent', borderBottomColor: t.border }]}>
      <Avatar uri={url} size={52} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={s.line}>
          <Text numberOfLines={1} style={[s.name, { color: t.text }]}>{row.other_name}</Text>
          <Text style={{ color: row.unread ? t.text : t.text2, fontSize: 13, fontWeight: row.unread ? '700' : '400' }}>{timeLabel(row.last_at)}</Text>
        </View>
        <View style={s.line}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: row.unread ? t.text : t.text2, fontWeight: row.unread ? '500' : '400' }}>
            {row.unavailable ? 'Conversation unavailable' : preview}
          </Text>
          <Badge n={row.unread} label="unread" />
        </View>
      </View>
    </Pressable>
  );
});

export const ProfileCard = memo(function ProfileCard({ row, url, width, onPress }: { row: NearbyRow; url?: string; width: number; onPress: (id: string) => void }) {
  const { theme: t } = useTheme();
  const place = row.distance_band ?? row.city;
  const live = !!row.tonight_text;
  return (
    <Pressable onPress={() => onPress(row.id)} accessibilityRole="button"
      accessibilityLabel={`${row.name}, ${row.age}. ${place}.${live ? ` Free tonight: ${row.tonight_text}.` : ''}`}
      style={({ pressed }) => [{ width, aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: t.surface2, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <Image source={url ? { uri: url } : undefined} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={url} transition={150} />
      <View style={s.scrim} />
      {live ? <View style={s.pill}><Text style={s.pillText}>Tonight</Text></View> : null}
      <View style={s.meta}>
        <Text style={s.cardName} numberOfLines={1}>{row.name}, {row.age}</Text>
        <Text style={s.cardPlace} numberOfLines={1}>{place}</Text>
        {row.shared_tags > 0 ? <Text style={s.cardShared} numberOfLines={1}>You share {row.shared_tags} interest{row.shared_tags > 1 ? 's' : ''}</Text> : null}
      </View>
    </Pressable>
  );
});

export const RequestRow = memo(function RequestRow({ item, url, busy, onOpen, onAccept, onDecline, onCancel }: {
  item: RequestItem; url?: string; busy: boolean; onOpen: (id: string) => void; onAccept: (id: string) => void; onDecline: (id: string) => void; onCancel: (id: string) => void;
}) {
  const { theme: t } = useTheme();
  const incoming = item.direction === 'incoming';
  return (
    <View style={[s.req, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Pressable onPress={() => onOpen(item.other_id)} style={s.line} accessibilityRole="button" accessibilityLabel={`Open ${item.name}'s profile`}>
        <Avatar uri={url} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={[s.name, { color: t.text }]}>{item.name}</Text>
          <Text style={{ color: t.text2, fontSize: 15 }}>{timeLabel(item.created_at)}</Text>
        </View>
      </Pressable>
      {item.note ? (
        <View style={{ backgroundColor: t.bg, borderRadius: 14, padding: 12, gap: 2 }}>
          {item.prompt ? <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>{incoming ? 'Replied to your' : 'You replied to'} “{item.prompt}”</Text> : null}
          <Text style={{ color: t.text, fontSize: 15 }}>{item.note}</Text>
        </View>
      ) : null}
      <View style={s.line}>
        {incoming ? (<>
          <View style={{ flex: 1 }}><Button title="Decline" kind="ghost" disabled={busy} onPress={() => onDecline(item.id)} /></View>
          <View style={{ flex: 1 }}><Button title="Accept" busy={busy} busyTitle="Accepting" onPress={() => onAccept(item.id)} /></View>
        </>) : (
          <View style={{ flex: 1 }}><Button title="Cancel request" kind="ghost" busy={busy} busyTitle="Cancelling" onPress={() => onCancel(item.id)} /></View>
        )}
      </View>
    </View>
  );
});

export type PendingMsg = { clientId: string; body: string; status: 'sending' | 'failed'; at: number };

/** `item` is either a server message or a local pending one. "Sent" is only shown for server-confirmed messages. */
export const MessageBubble = memo(function MessageBubble({ body, mine, status, time, showStatus, onRetry }: {
  body: string; mine: boolean; status: 'sent' | 'sending' | 'failed'; time: string; showStatus: boolean; onRetry?: () => void;
}) {
  const { theme: t } = useTheme();
  const bubble = (
    <View style={[s.bubble, mine ? { backgroundColor: status === 'failed' ? t.surface : t.accent, borderBottomRightRadius: 6, borderWidth: status === 'failed' ? 1.5 : 0, borderColor: t.error, opacity: status === 'sending' ? 0.65 : 1 }
      : { backgroundColor: t.bubbleThem, borderBottomLeftRadius: 6 }]}>
      <Text selectable style={{ fontSize: 17, color: mine ? (status === 'failed' ? t.text : t.onAccent) : t.text }}>{body}</Text>
    </View>
  );
  const caption = status === 'failed' ? 'Not sent · Tap to retry' : status === 'sending' ? `${time} · Sending` : showStatus && mine ? `${time} · Sent` : time;
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', alignItems: mine ? 'flex-end' : 'flex-start', maxWidth: '78%', paddingHorizontal: 12, marginVertical: 1 }}>
      {status === 'failed' ? <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={`Message not sent: ${body}. Tap to retry`}>{bubble}</Pressable> : bubble}
      {showStatus || status !== 'sent' ? <Text style={{ fontSize: 11, color: status === 'failed' ? t.error : t.text2, marginHorizontal: 6, marginTop: 3, marginBottom: 6 }}>{caption}</Text> : null}
    </View>
  );
});

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: '600' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, top: '45%', backgroundColor: 'rgba(16,10,30,0.7)' },
  meta: { position: 'absolute', left: 12, right: 10, bottom: 10 },
  cardName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cardPlace: { color: '#fff', fontSize: 13, opacity: 0.95 },
  cardShared: { color: '#E5DCFF', fontSize: 13 },
  pill: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(20,14,34,0.75)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  req: { borderRadius: 18, padding: 14, gap: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20 },
});
