import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useNetInfo } from '@react-native-community/netinfo';
import { Text, View, type ColorValue } from 'react-native';
import { useTheme } from '../../src/lib/theme';
import { useConversations } from '../../src/lib/queries';

export default function TabsLayout() {
  const { theme: t } = useTheme();
  const net = useNetInfo();
  const { data } = useConversations(false);
  const unread = (data ?? []).reduce((n, c) => n + (c.unavailable ? 0 : c.unread), 0);
  const icon = (name: 'chatbubbles' | 'location' | 'person') => ({ color, focused }: { color: ColorValue; focused: boolean }) =>
    <Ionicons name={focused ? name : (`${name}-outline` as 'chatbubbles-outline')} size={24} color={color as string} />;
  return (
    <View style={{ flex: 1 }}>
      {net.isConnected === false ? (
        <View style={{ backgroundColor: t.errorSoft, paddingTop: 54, paddingBottom: 8, paddingHorizontal: 16 }} accessibilityRole="alert">
          <Text style={{ color: t.text, fontSize: 15 }}>You’re offline. Showing what we last loaded.</Text>
        </View>
      ) : null}
      <Tabs screenOptions={{
        headerShown: false, tabBarActiveTintColor: t.accent, tabBarInactiveTintColor: t.text2,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.border }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: t.bg },
      }}>
        <Tabs.Screen name="chats" options={{ title: 'Chats', tabBarIcon: icon('chatbubbles'), tabBarBadge: unread || undefined, tabBarBadgeStyle: { backgroundColor: t.unread, color: t.onUnread } }} />
        <Tabs.Screen name="nearby" options={{ title: 'Nearby', tabBarIcon: icon('location') }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person') }} />
        <Tabs.Screen name="index" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
