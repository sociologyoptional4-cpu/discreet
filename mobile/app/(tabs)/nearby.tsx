import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, Text, useWindowDimensions, View, PixelRatio } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorNote, HIT } from '../../src/components/ui';
import { Choice } from '../../src/components/form';
import { ProfileCard } from '../../src/components/rows';
import { api } from '../../src/lib/api';
import { useSession } from '../../src/lib/session';
import { useSignedUrls } from '../../src/lib/signedUrls';
import { useTheme } from '../../src/lib/theme';
import { messageOf } from '../../src/lib/errors';
import type { NearbyRow } from '../../src/lib/types';

const GUTTER = 16;

export default function Nearby() {
  const { theme: t } = useTheme();
  const { profile } = useSession();
  const { width } = useWindowDimensions();
  const [cityId, setCityId] = useState<number | null>(null);
  const [tonight, setTonight] = useState(false);
  const [picker, setPicker] = useState(false);
  const cities = useQuery({ queryKey: ['cities'], queryFn: api.cities, staleTime: Infinity });
  const activeCity = cityId ?? profile!.city_id;
  const cityName = cities.data?.find((c) => c.id === activeCity)?.name ?? profile!.city;

  const feed = useInfiniteQuery({
    queryKey: ['nearby', activeCity, tonight],
    initialPageParam: undefined as { createdAt: string; id: string } | undefined,
    queryFn: ({ pageParam }) => api.listNearby({ cityId: activeCity, tonightOnly: tonight, after: pageParam }),
    getNextPageParam: (last: NearbyRow[]) => (last.length === 30 ? { createdAt: last[last.length - 1].created_at, id: last[last.length - 1].id } : undefined),
  });
  const rows = useMemo(() => feed.data?.pages.flat() ?? [], [feed.data]);
  const urls = useSignedUrls(rows.map((r) => r.thumb_key));

  // One column when the user's text size is large enough that two columns would crowd the labels.
  const oneColumn = PixelRatio.getFontScale() >= 1.3;
  const cols = oneColumn ? 1 : 2;
  const cardW = (width - GUTTER * 2 - (cols - 1) * 12) / cols;

  const header = (
    <View style={{ gap: 10, paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: GUTTER }}>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 }}>Nearby</Text>
        <Pressable onPress={() => setPicker(true)} accessibilityRole="button" accessibilityLabel={`Current city ${cityName}. Change city`}
          style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, justifyContent: 'center' }}>
          <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{cityName} ⌄</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: GUTTER }}>
        <Pressable onPress={() => setTonight(!tonight)} accessibilityRole="button" accessibilityState={{ selected: tonight }}
          style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: tonight ? t.accent : t.surface, borderWidth: 1, borderColor: tonight ? t.accent : t.border }}>
          <Text style={{ color: tonight ? t.onAccent : t.text, fontSize: 15, fontWeight: '600' }}>Free tonight</Text>
        </Pressable>
      </View>
      {feed.isError ? <ErrorNote text={messageOf(feed.error)} onRetry={() => feed.refetch()} /> : null}
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        key={cols} numColumns={cols} data={rows} keyExtractor={(r) => r.id} ListHeaderComponent={header}
        columnWrapperStyle={cols > 1 ? { gap: 12, paddingHorizontal: GUTTER } : undefined}
        contentContainerStyle={{ gap: 12, paddingBottom: 32, paddingHorizontal: cols > 1 ? 0 : GUTTER }}
        renderItem={({ item }) => <ProfileCard row={item} width={cardW} url={item.thumb_key ? urls[item.thumb_key] : undefined} onPress={(id) => router.push(`/user/${id}`)} />}
        initialNumToRender={8} windowSize={7} removeClippedSubviews
        onEndReached={() => { if (feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage(); }} onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={feed.isRefetching && !feed.isFetchingNextPage} onRefresh={() => { void feed.refetch(); }} tintColor={t.accent} />}
        ListEmptyComponent={feed.isPending ? <Text style={{ color: t.text2, padding: 24 }}>Loading people nearby…</Text>
          : <EmptyState title={tonight ? 'No one has posted for tonight yet' : `No one in ${cityName} yet`} body={tonight ? 'Be the first: post a Tonight status from Profile.' : 'Nearby Chat is new here. Try another city, or check back soon.'}
              action={<Button title="Choose another city" onPress={() => setPicker(true)} />} />}
        ListFooterComponent={<Text style={{ color: t.text2, fontSize: 13, padding: GUTTER }}>Distances appear only when both people opt in, and only as broad bands.</Text>}
      />
      <Modal visible={picker} animationType="slide" transparent onRequestClose={() => setPicker(false)}>
        <Pressable style={{ flex: 1, backgroundColor: t.scrim }} onPress={() => setPicker(false)} accessibilityLabel="Close city picker" />
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 32 }}>
          <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700', padding: 16 }}>Choose city</Text>
          {(cities.data ?? []).map((c) => <Choice key={c.id} title={c.name} selected={c.id === activeCity} onPress={() => { setCityId(c.id); setPicker(false); }} />)}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
