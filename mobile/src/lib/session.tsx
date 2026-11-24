import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isConfigured } from './supabase';
import { api } from './api';
import type { MyProfile } from './types';

type State = { ready: boolean; session: Session | null; profile: MyProfile | null; refreshProfile: () => void; signOut: () => Promise<void> };
const Ctx = createContext<State>({ ready: false, session: null, profile: null, refreshProfile: () => {}, signOut: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [booted, setBooted] = useState(!isConfigured);

  useEffect(() => {
    if (!isConfigured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setBooted(true); });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // Account-specific caches must not survive a sign-out or an account switch.
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'cities' });
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const uid = session?.user.id;
  const profileQ = useQuery({ queryKey: ['me', uid], enabled: !!uid, queryFn: api.myProfile });

  const value: State = {
    ready: booted && (!uid || !profileQ.isPending),
    session,
    profile: profileQ.data ?? null,
    refreshProfile: () => { qc.invalidateQueries({ queryKey: ['me'] }); },
    signOut: async () => { await supabase.auth.signOut(); qc.clear(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
