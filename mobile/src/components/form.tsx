import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../lib/theme';
import { HIT } from './ui';

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const { theme: t } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: t.text2, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        {hint ? <Text style={{ color: t.text2, fontSize: 13 }}>{hint}</Text> : null}
      </View>
      <TextInput placeholderTextColor={t.text3} accessibilityLabel={label}
        style={{ minHeight: props.multiline ? 88 : 50, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, textAlignVertical: props.multiline ? 'top' : 'center' }}
        {...props} />
    </View>
  );
}

export function TagPicker({ all, value, max, onChange }: { all: string[]; value: string[]; max: number; onChange: (v: string[]) => void }) {
  const { theme: t } = useTheme();
  const toggle = (tag: string) => {
    if (value.includes(tag)) onChange(value.filter((x) => x !== tag));
    else if (value.length < max) onChange([...value, tag]);
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {all.map((tag) => {
        const on = value.includes(tag);
        return (
          <Pressable key={tag} onPress={() => toggle(tag)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: on ? t.accent : t.surface, borderWidth: 1, borderColor: on ? t.accent : t.border }}>
            <Text style={{ color: on ? t.onAccent : t.text, fontSize: 15, fontWeight: on ? '600' : '400' }}>{tag}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Choice({ title, selected, onPress }: { title: string; selected: boolean; onPress: () => void }) {
  const { theme: t } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}
      style={{ minHeight: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5, borderBottomColor: t.border }}>
      <Text style={{ color: t.text, fontSize: 17 }}>{title}</Text>
      {selected ? <Text style={{ color: t.accent, fontSize: 17, fontWeight: '700' }}>✓</Text> : null}
    </Pressable>
  );
}
