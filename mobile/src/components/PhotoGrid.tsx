import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../lib/theme';
import { HIT } from './ui';
import { MAX_PHOTOS } from '../lib/photos';

export type Slot = { key: string; uri: string; isNew: boolean };

/** Up to four photos; first is the main one. Reorder with explicit buttons (also the accessible path). */
export function PhotoGrid({ slots, onAdd, onRemove, onMove }: { slots: Slot[]; onAdd: () => void; onRemove: (i: number) => void; onMove: (i: number, d: -1 | 1) => void }) {
  const { theme: t } = useTheme();
  const small = { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(20,14,34,0.65)', alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {Array.from({ length: MAX_PHOTOS }, (_, i) => {
        const s = slots[i];
        return (
          <View key={i} style={{ width: '48%', aspectRatio: 3 / 4, borderRadius: 14, overflow: 'hidden', backgroundColor: t.surface, borderWidth: s ? 0 : 1.5, borderColor: t.border, borderStyle: 'dashed' }}>
            {s ? (<>
              <Image source={{ uri: s.uri }} style={{ flex: 1 }} contentFit="cover" accessibilityLabel={`Photo ${i + 1}${i === 0 ? ', main' : ''}`} />
              {i === 0 ? <Text style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: '#20192B', color: '#fff', fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' }}>Main</Text> : null}
              <Pressable onPress={() => onRemove(i)} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`} hitSlop={4} style={[small, { position: 'absolute', top: 6, right: 6 }]}><Text style={{ color: '#fff', fontSize: 18 }}>×</Text></Pressable>
              <View style={{ position: 'absolute', right: 6, bottom: 6, flexDirection: 'row', gap: 6 }}>
                {i > 0 ? <Pressable onPress={() => onMove(i, -1)} accessibilityRole="button" accessibilityLabel={`Move photo ${i + 1} earlier`} hitSlop={4} style={small}><Text style={{ color: '#fff' }}>‹</Text></Pressable> : null}
                {i < slots.length - 1 ? <Pressable onPress={() => onMove(i, 1)} accessibilityRole="button" accessibilityLabel={`Move photo ${i + 1} later`} hitSlop={4} style={small}><Text style={{ color: '#fff' }}>›</Text></Pressable> : null}
              </View>
            </>) : (
              <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add photo from library" style={{ flex: 1, minHeight: HIT, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <Text style={{ color: t.accent, fontSize: 28 }}>+</Text><Text style={{ color: t.accent, fontWeight: '600' }}>Add</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}
