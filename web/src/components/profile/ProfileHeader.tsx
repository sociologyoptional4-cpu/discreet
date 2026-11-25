'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, Check, Share2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ClayBuddy } from '@/components/chat/AvatarStickerMessage';
import { MessageButton } from '@/components/MessageButton';
import { EditBioSheet } from '@/components/profile/EditBioSheet';
import { OwnProfileExtras } from '@/components/profile/OwnProfileExtras';
import type { SocialActions } from '@/hooks/useSocialActions';
import { compactCount, levelProgress, ringColor, XP_PER_LEVEL } from '@/lib/profileFormat';
import { handleShare } from '@/lib/share';
import type { ProfilePageResponse } from '@/types/social';

const SPRING = { type: 'spring', stiffness: 420, damping: 28 } as const;
const glass = 'border border-white/80 bg-white/60 backdrop-blur-xl shadow-[0_8px_28px_rgba(15,23,42,.08)]';

type Props = {
  data: ProfilePageResponse;
  social: SocialActions;
  onBioSaved: (bio: string) => void;
};

/** Top bar, identity and vibe card, stats and the follow / message / edit actions of a creator profile. */
export function ProfileHeader({ data, social, onBioSaved }: Props) {
  const { profile, isOwnProfile, postsCount } = data;
  const router = useRouter();
  const reduce = useReducedMotion();
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const follow = social.followView(profile.id, { following: data.isFollowing, followers: profile.followers_count });
  const progress = levelProgress(profile.vibe_xp);
  const ring = ringColor(profile.vibe_level);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 2200);
  };
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/feed');
  };
  const share = async () => {
    const result = await handleShare({
      title: `@${profile.username} on Vybe`,
      text: profile.bio || 'Faceless reviews on Vybe',
      url: `${window.location.origin}/profile/${profile.username}`,
    });
    if (result === 'copied') flash('Profile link copied');
    else if (result === 'failed') flash('Could not share this profile');
  };
  const toggleFollow = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(15);
    void social.toggleFollow({ id: profile.id, username: profile.username }, follow.following);
  };

  const stats = [
    { label: 'Posts', value: postsCount },
    { label: 'Followers', value: follow.followers },
    { label: 'Following', value: profile.following_count },
  ];

  return (
    <header className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center">
        <button type="button" onClick={goBack} aria-label="Back" className={`${glass} flex size-11 items-center justify-center rounded-full text-slate-800 focus-visible:outline-2 focus-visible:outline-violet-400`}>
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <h1 className="truncate text-center text-[15px] font-bold tracking-tight text-slate-900">@{profile.username}</h1>
        <button type="button" onClick={() => void share()} aria-label="Share profile" className={`${glass} flex size-11 items-center justify-center rounded-full text-slate-800 focus-visible:outline-2 focus-visible:outline-violet-400`}>
          <Share2 aria-hidden className="size-[18px]" />
        </button>
      </div>

      <section className={`${glass} mt-4 flex flex-col items-center gap-3 rounded-[28px] px-5 pb-5 pt-6 text-center`}>
        <div
          className="grid size-[104px] place-items-center rounded-full p-[3px]"
          style={{ background: `conic-gradient(from 140deg, ${ring}, ${ringColor(profile.vibe_level + 3)}, ${ring})`, boxShadow: `0 0 30px ${ring}88` }}
        >
          <div className="grid size-full place-items-center overflow-hidden rounded-full bg-white/85">
            <ClayBuddy avatarId={profile.avatar_id} stickerId="wave" size={76} />
          </div>
        </div>

        <div className="w-full">
          <p className="text-lg font-black tracking-tight text-slate-900">@{profile.username}</p>
          {profile.bio && <p className="mx-auto mt-1 line-clamp-2 max-w-[18rem] text-[13px] leading-snug text-slate-600">{profile.bio}</p>}
        </div>

        <div className="w-full max-w-[16rem]" role="group" aria-label={`Vibe level ${profile.vibe_level}, ${profile.vibe_xp} XP`}>
          <div className="flex items-center justify-between text-[10px] font-bold tracking-[0.14em] text-slate-500">
            <span>LVL {profile.vibe_level}</span>
            <span className="tabular-nums">{profile.vibe_xp} XP</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-900/10">
            <motion.div
              className="h-full origin-left rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-sky-400"
              initial={{ scaleX: reduce ? progress : 0 }}
              animate={{ scaleX: progress }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 20 }}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-400">{Math.round(XP_PER_LEVEL * (1 - progress))} XP to level {profile.vibe_level + 1}</p>
        </div>

        {profile.badges.length > 0 && (
          <ul aria-label="Badges" className="flex flex-wrap justify-center gap-1.5">
            {profile.badges.map((badge) => (
              <li key={badge.id} className="rounded-full border border-white/90 bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-slate-700 backdrop-blur-md">{badge.label}</li>
            ))}
          </ul>
        )}

        <dl className="grid w-full grid-cols-3 divide-x divide-slate-900/10">
          {stats.map((stat) => (
            <div key={stat.label} className="px-2">
              <dd className="text-lg font-black tabular-nums text-slate-900">{compactCount(stat.value)}</dd>
              <dt className="text-[11px] text-slate-500">{stat.label}</dt>
            </div>
          ))}
        </dl>

        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          {isOwnProfile ? (
            <>
              <button type="button" onClick={() => setEditing(true)} className={`${glass} min-h-11 rounded-full px-5 text-sm font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-violet-400`}>Edit profile</button>
              <button type="button" onClick={() => void share()} className={`${glass} min-h-11 rounded-full px-5 text-sm font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-violet-400`}>Share</button>
            </>
          ) : (
            <>
              <motion.button
                type="button"
                onClick={toggleFollow}
                aria-pressed={follow.following}
                layout
                whileTap={{ scale: 0.94 }}
                transition={SPRING}
                className={`flex min-h-11 min-w-32 items-center justify-center gap-1.5 rounded-full px-6 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 ${
                  follow.following ? `${glass} text-slate-700` : 'bg-slate-900 text-white shadow-[0_10px_26px_rgba(139,92,246,.35)]'
                }`}
              >
                {follow.following ? <><Check aria-hidden className="size-4" /> Following</> : 'Follow'}
              </motion.button>
              <MessageButton creatorId={profile.id} />
            </>
          )}
        </div>
        {isOwnProfile && <OwnProfileExtras userId={profile.id} />}
        {social.error && <p role="alert" className="text-sm text-rose-700">{social.error}</p>}
      </section>

      <AnimatePresence>
        {toast && (
          <motion.p role="status" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[70] mx-auto w-fit rounded-full border border-white/80 bg-white/75 px-4 py-2 text-sm font-medium text-slate-800 shadow-lg backdrop-blur-xl">
            {toast}
          </motion.p>
        )}
      </AnimatePresence>
      <EditBioSheet open={editing} userId={profile.id} initialBio={profile.bio} onClose={() => setEditing(false)} onSaved={(bio) => { onBioSaved(bio); setEditing(false); flash('Bio updated'); }} />
    </header>
  );
}
