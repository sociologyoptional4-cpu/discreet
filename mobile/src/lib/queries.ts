import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useSession } from './session';

const uid = () => useSession().session?.user.id;

// Polling is a Phase-2 stand-in: Phase 3 replaces it with private Realtime hints plus cursor catch-up.
export function useConversations(poll = true) {
  const id = uid();
  return useQuery({ queryKey: ['conversations', id], enabled: !!id, queryFn: api.listConversations, refetchInterval: poll ? 8000 : false });
}
export function useRequests() {
  const id = uid();
  return useQuery({ queryKey: ['requests', id], enabled: !!id, queryFn: api.listRequests, refetchInterval: 15000 });
}
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['conversations'] }), qc.invalidateQueries({ queryKey: ['requests'] }), qc.invalidateQueries({ queryKey: ['profile'] }), qc.invalidateQueries({ queryKey: ['nearby'] })]);
}
