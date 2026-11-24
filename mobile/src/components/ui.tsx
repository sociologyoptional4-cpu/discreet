import { memo, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../lib/theme';

export const HIT = 44; // minimum touch target in points

export function Avatar({ uri, size = 52, ring = false, label }: { uri?: string; size?: number; ring?: boolean; label?: string }) {
  const { theme: t } = useTheme();
  const box: ViewStyle = { width: size, height: size, borderRadius: size / 2, borderWidth: ring ? 2 : 0, borderColor: t.accent, padding: ring ? 2 : 0 };
  return (
    <View style={box} accessible={!!label} accessibilityLabel={label} accessibilityRole={label ? 'image' : undefined}>
      <Image source={uri ? { uri } : undefined} style={{ flex: 1, borderRadius: size / 2, backgroundColor: t.surface2 }}
        contentFit="cover" recyclingKey={uri} transition={120} />
    </View>
  );
}

export const Badge = memo(function Badge({ n, label }: { n: number; label: string }) {
  const { theme: t } = useTheme();
  if (!n) return null;
  return (
    <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 7, backgroundColor: t.unread, alignItems: 'center', justifyContent: 'center' }}
      accessible accessibilityLabel={`${n} ${label}`}>
      <Text style={{ color: t.onUnread, fontSize: 13, fontWeight: '700' }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
});

type BtnProps = { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'soft' | 'danger'; busy?: boolean; disabled?: boolean; busyTitle?: string; small?: boolean };
export function Button({ title, onPress, kind = 'primary', busy, disabled, busyTitle, small }: BtnProps) {
  const { theme: t } = useTheme();
  const bg = { primary: t.accent, ghost: t.surface2, soft: t.accentSoft, danger: t.error }[kind];
  const fg = { primary: t.onAccent, ghost: t.text, soft: t.accentInk, danger: t.dark ? '#14111C' : '#FFFFFF' }[kind];
  const off = disabled || busy;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }}
      accessibilityLabel={busy && busyTitle ? busyTitle : title}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, minHeight: small ? HIT : 50, opacity: off && !busy ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ color: fg, fontSize: small ? 15 : 17, fontWeight: '600' }}>{busy && busyTitle ? busyTitle : title}</Text>
    </Pressable>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  const { theme: t } = useTheme();
  return (
    <View style={s.empty}>
      <Text style={{ color: t.text, fontSize: 20, fontWeight: '700', textAlign: 'center' }} accessibilityRole="header">{title}</Text>
      <Text style={{ color: t.text2, fontSize: 15, textAlign: 'center', maxWidth: 300 }}>{body}</Text>
      {action}
    </View>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const { theme: t } = useTheme();
  return (
    <View style={[s.note, { backgroundColor: t.errorSoft }]} accessibilityRole="alert">
      <Text style={{ color: t.text, flex: 1, fontSize: 15 }}>{text}</Text>
      {onRetry ? <Pressable onPress={onRetry} style={{ minHeight: HIT, justifyContent: 'center' }} accessibilityRole="button"><Text style={{ color: t.accent, fontWeight: '700' }}>Retry</Text></Pressable> : null}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: 14 },
  empty: { alignItems: 'center', gap: 10, padding: 32 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginVertical: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
});
