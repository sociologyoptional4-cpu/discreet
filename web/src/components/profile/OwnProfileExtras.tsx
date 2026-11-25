'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AVATAR_CATALOG, getChosenAvatarUrl, setChosenAvatarUrl } from '@/lib/avatarCatalog';
import { supabase } from '@/lib/supabase';

/** Owner-only shortcuts: the notifications page and the 3D avatar chooser. */
export function OwnProfileExtras({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [chosenUrl, setChosenUrl] = useState<string | null>(() => getChosenAvatarUrl());

  return (
    <div className="w-full">
      <div className="flex justify-center gap-2 text-xs font-semibold">
        <Link href="/notifications" className="rounded-full border border-white/90 bg-white/65 px-3 py-1.5 text-slate-700">Notifications</Link>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-full border border-white/90 bg-white/65 px-3 py-1.5 text-slate-700">
          {open ? 'Hide 3D avatars' : `3D avatar (${AVATAR_CATALOG.length})`}
        </button>
      </div>
      {open && (
        <div className="mt-3 grid max-h-60 grid-cols-3 gap-2 overflow-y-auto rounded-2xl border border-white/85 bg-white/75 p-2.5 text-left shadow-sm backdrop-blur-xl">
          {AVATAR_CATALOG.map((item) => {
            const active = chosenUrl === item.vrmUrl;
            return (
              <button key={item.id} type="button"
                onClick={() => {
                  setChosenAvatarUrl(item.vrmUrl);
                  setChosenUrl(item.vrmUrl);
                  setOpen(false);
                  void supabase.from('users').update({ custom_avatar_url: item.vrmUrl }).eq('id', userId);
                }}
                className={`rounded-xl px-2.5 py-2 text-xs font-semibold transition ${active ? 'bg-slate-900 text-white' : 'bg-white/80 text-slate-800 hover:bg-white'}`}>
                <span className="block truncate">{item.name}</span>
                <span className={`block text-[10px] ${active ? 'text-white/70' : 'text-slate-500'}`}>{item.series}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
