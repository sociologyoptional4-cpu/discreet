import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '../src/lib/theme';
import { SessionProvider, useSession } from '../src/lib/session';
import { isConfigured } from '../src/lib/supabase';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: false } },
});

function Gate() {
  const { theme: t } = useTheme();
  const { ready, session, profile } = useSession();
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  if (!isConfigured) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, padding: 32, justifyContent: 'center', gap: 12 }}>
        <Text style={{ color: t.text, fontSize: 24, fontWeight: '700' }}>Backend not connected</Text>
        <Text style={{ color: t.text2, fontSize: 16 }}>
          Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart Metro.
        </Text>
      </View>
    );
  }
  if (!ready) return null; // splash screen stays up until the session and profile are known
  const signedOut = !session, needsProfile = !!session && !profile, member = !!session && !!profile;
  return (
    <>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'default' }}>
        <Stack.Protected guard={signedOut}><Stack.Screen name="(auth)" /></Stack.Protected>
        <Stack.Protected guard={needsProfile}><Stack.Screen name="onboarding" /></Stack.Protected>
        <Stack.Protected guard={member}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="user/[id]" />
          <Stack.Screen name="requests" />
          <Stack.Screen name="edit-profile" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function Root() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <SessionProvider><Gate /></SessionProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
