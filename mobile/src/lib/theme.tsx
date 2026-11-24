import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type Theme = {
  dark: boolean; bg: string; surface: string; surface2: string; text: string; text2: string; text3: string;
  accent: string; onAccent: string; accentSoft: string; accentInk: string; border: string;
  unread: string; onUnread: string; error: string; errorSoft: string; bubbleThem: string; scrim: string;
};

// Semantic tokens. Contrast ratios for these pairs are listed in docs/design-tokens.md.
export const LIGHT: Theme = {
  dark: false, bg: '#F3F0F7', surface: '#FAF7FC', surface2: '#ECE6F3', text: '#20192B', text2: '#625A6C', text3: '#8E859A',
  accent: '#5438C3', onAccent: '#FFFFFF', accentSoft: '#E7E0FA', accentInk: '#3F27A3', border: '#E2DBEA',
  unread: '#F2A93B', onUnread: '#20192B', error: '#C0392B', errorSoft: '#FBEAE8', bubbleThem: '#ECE6F3', scrim: 'rgba(20,17,28,0.45)',
};
export const DARK: Theme = {
  dark: true, bg: '#14111C', surface: '#211A2D', surface2: '#2B2239', text: '#F3EDF8', text2: '#BAB0C7', text3: '#8D839C',
  accent: '#B9A5FF', onAccent: '#14111C', accentSoft: '#2F2648', accentInk: '#D3C7FF', border: '#32283F',
  unread: '#F5B451', onUnread: '#14111C', error: '#FF8A80', errorSoft: '#3A1F25', bubbleThem: '#2B2239', scrim: 'rgba(0,0,0,0.55)',
};

export type Pref = 'system' | 'light' | 'dark';
const KEY = 'nc-theme-pref';
const Ctx = createContext<{ theme: Theme; pref: Pref; setPref: (p: Pref) => void }>({ theme: LIGHT, pref: 'system', setPref: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<Pref>('system');
  useEffect(() => {
    SecureStore.getItemAsync(KEY).then((v) => { if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v); }).catch(() => {});
  }, []);
  const setPref = (p: Pref) => { setPrefState(p); SecureStore.setItemAsync(KEY, p).catch(() => {}); };
  const value = useMemo(() => {
    const dark = pref === 'system' ? system === 'dark' : pref === 'dark';
    return { theme: dark ? DARK : LIGHT, pref, setPref };
  }, [pref, system]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
