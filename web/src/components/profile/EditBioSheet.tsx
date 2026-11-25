'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

const BIO_MAX = 200;

type Props = { open: boolean; userId: string; initialBio: string; onClose: () => void; onSaved: (bio: string) => void };

/** Small bottom sheet that edits the signed-in creator's bio in `public.users`. */
export function EditBioSheet({ open, ...rest }: Props) {
  return <AnimatePresence>{open && <BioForm key="bio-form" {...rest} />}</AnimatePresence>;
}

function BioForm({ userId, initialBio, onClose, onSaved }: Omit<Props, 'open'>) {
  const [bio, setBio] = useState(initialBio);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const next = bio.trim();
    const { error: failure } = await supabase.from('users').update({ bio: next }).eq('id', userId);
    setSaving(false);
    if (failure) setError('Could not save your bio. Try again.');
    else onSaved(next);
  };

  return (
    <motion.div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form
        role="dialog" aria-modal="true" aria-label="Edit profile"
        onSubmit={(event) => void save(event)} onClick={(event) => event.stopPropagation()}
        initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="w-full max-w-[430px] rounded-t-[28px] border border-white/80 bg-white/85 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-left shadow-2xl backdrop-blur-2xl"
      >
        <label htmlFor="bio-input" className="text-sm font-bold text-slate-900">Bio</label>
        <textarea id="bio-input" autoFocus value={bio} onChange={(event) => setBio(event.target.value)} maxLength={BIO_MAX} rows={4}
          className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-800 outline-none focus:border-violet-400" placeholder="Say something about your vibe" />
        <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
          <span role={error ? 'alert' : undefined} className={error ? 'text-rose-700' : ''}>{error ?? 'Shown under your @handle'}</span>
          <span className="tabular-nums">{bio.length}/{BIO_MAX}</span>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-full border border-slate-200 bg-white/70 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-full bg-slate-900 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </motion.form>
    </motion.div>
  );
}
