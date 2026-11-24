'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Captions, LoaderCircle, ShieldAlert, Sparkles, Type, Volume2, VolumeX } from 'lucide-react';
import { PublishSheet } from '@/components/PublishSheet';
import { AESTHETIC_FILTERS, composeCssFilter } from '@/lib/camera/filterPipeline';
import { VIDEO_TEMPLATES, type TemplateId } from '@/lib/camera/templateEngine';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { RecordedSnapPayload } from '@/types/privacy';

type Props = {
  videoUrl: string;
  onRetake: () => void;
  getSnap: () => Omit<RecordedSnapPayload, 'url' | 'expiry'> | null;
  onPublished?: (postId: string) => void;
  submit?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
  mimeType?: string;
  /** True when the clip was shot in Normal (real-face) mode; enforces the Public-Feed Faceless Guardrail. */
  isNormalFace?: boolean;
  onSwitchToMask?: () => void;
};

const frostedBtn =
  'flex size-11 items-center justify-center rounded-full backdrop-blur-xl bg-white/75 border border-white/90 shadow-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900';

const CAPTION_STYLES = {
  bold_pop: 'bg-amber-300 text-slate-950 font-black uppercase tracking-wide px-3 py-1 rounded-xl shadow-lg',
  minimal_frosted: 'bg-white/80 text-slate-900 font-semibold px-3.5 py-1.5 rounded-full border border-white backdrop-blur-xl shadow-md',
  neon_outline: 'bg-slate-950/85 text-cyan-300 font-bold border border-cyan-400/70 px-3.5 py-1 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.4)]',
} as const;

export function PreviewPlayer({
  videoUrl,
  onRetake,
  getSnap,
  onPublished,
  submit,
  submitLabel,
  mimeType = '',
  isNormalFace = false,
  onSwitchToMask,
}: Props) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const [templateId, setTemplateId] = useState<TemplateId>('none');
  const [showTemplates, setShowTemplates] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [captionStyle, setCaptionStyle] = useState<keyof typeof CAPTION_STYLES>('minimal_frosted');
  const [editingText, setEditingText] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [privacyApproved, setPrivacyApproved] = useState(false);
  const [showPrivacyGuard, setShowPrivacyGuard] = useState(false);

  const activeTemplate = VIDEO_TEMPLATES.find((t) => t.id === templateId) ?? VIDEO_TEMPLATES[0];
  const templatePreset = AESTHETIC_FILTERS.find((f) => f.id === activeTemplate.filterId) ?? AESTHETIC_FILTERS[0];
  const isImage = mimeType.startsWith('image/');

  useEffect(() => {
    const v = videoRef.current;
    if (!v || isImage) return;
    v.playbackRate = activeTemplate.playbackRate;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, [videoUrl, isImage, activeTemplate.playbackRate]);

  const generateAutoCaptions = async () => {
    if (transcribing) return;
    const snap = getSnap();
    if (!snap?.blob || isImage) return;
    setTranscribing(true);
    try {
      const form = new FormData();
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      form.append('audio', snap.blob, `clip.${ext}`);
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      const data = (await res.json().catch(() => null)) as { transcript?: string } | null;
      if (data?.transcript) {
        setCaptionText(data.transcript);
      }
    } finally {
      setTranscribing(false);
    }
  };

  const cycleCaptionStyle = () => {
    setCaptionStyle((cur) =>
      cur === 'minimal_frosted' ? 'bold_pop' : cur === 'bold_pop' ? 'neon_outline' : 'minimal_frosted',
    );
  };

  const ext = isImage ? 'png' : mimeType.includes('mp4') ? 'mp4' : 'webm';

  return (
    <section className="fixed inset-0 z-30 mx-auto flex h-[100dvh] w-full max-w-[430px] items-center justify-center overflow-hidden bg-[#0A0A0A]" aria-label="Preview and edit your snap">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={videoUrl}
          alt="Captured snapshot"
          style={{ filter: composeCssFilter(templatePreset) }}
          className="h-full w-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          src={videoUrl}
          autoPlay
          loop
          playsInline
          muted={muted}
          style={{ filter: composeCssFilter(templatePreset) }}
          className="h-full w-full object-cover"
        />
      )}

      {/* Top-Left: Frosted Back button */}
      <button
        type="button"
        onClick={onRetake}
        aria-label="Back to camera"
        className={`${frostedBtn} absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40`}
      >
        <ArrowLeft aria-hidden className="size-5" />
      </button>

      {/* Top-Right: Mini-Editor Tools (Templates, Auto-Captions, Text Sticker, Mute) */}
      <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowTemplates((s) => !s)}
          aria-label="1-Tap Templates"
          aria-pressed={showTemplates}
          className={frostedBtn}
        >
          <Sparkles aria-hidden className="size-4" />
        </button>
        {!isImage && (
          <button
            type="button"
            onClick={() => void generateAutoCaptions()}
            disabled={transcribing}
            aria-label="Auto captions"
            className={frostedBtn}
          >
            {transcribing ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Captions aria-hidden className="size-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (editingText) cycleCaptionStyle();
            else setEditingText(true);
          }}
          aria-label="Add text overlay"
          className={frostedBtn}
        >
          <Type aria-hidden className="size-4" />
        </button>
        {!isImage && (
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            className={frostedBtn}
          >
            {muted ? <VolumeX aria-hidden className="size-5" /> : <Volume2 aria-hidden className="size-5" />}
          </button>
        )}
      </div>

      {/* 1-Tap Templates Bar */}
      {showTemplates && (
        <div className="absolute inset-x-3 top-[max(4rem,calc(env(safe-area-inset-top)+3.25rem))] z-40 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {VIDEO_TEMPLATES.map((tpl) => {
            const on = tpl.id === templateId;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  setTemplateId(tpl.id);
                  setCaptionStyle(tpl.captionPreset);
                }}
                className={`shrink-0 rounded-2xl border px-3 py-2 text-left text-xs backdrop-blur-xl transition ${
                  on ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-white/90 bg-white/80 text-slate-900'
                }`}
              >
                <div className="font-bold">{tpl.badge} {tpl.name}</div>
                <div className={`text-[10px] ${on ? 'text-white/75' : 'text-slate-500'}`}>{tpl.tagline}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Animated Caption / Text Overlay */}
      {(captionText || editingText) && (
        <div className="absolute inset-x-6 bottom-28 z-40 flex flex-col items-center gap-2 text-center">
          {editingText ? (
            <div className="flex w-full max-w-xs items-center gap-1.5 rounded-full border border-white/95 bg-white/85 px-3 py-1.5 shadow-lg backdrop-blur-xl">
              <input
                type="text"
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                placeholder="Type caption or sticker text…"
                autoFocus
                className="flex-1 bg-transparent text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={cycleCaptionStyle}
                className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700"
              >
                Style
              </button>
              <button
                type="button"
                onClick={() => setEditingText(false)}
                className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[10px] font-bold text-white"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingText(true)}
              className={`max-w-[90%] text-sm ${CAPTION_STYLES[captionStyle]}`}
            >
              {captionText}
            </button>
          )}
        </div>
      )}

      {/* Public-Feed Faceless Guardrail Modal (when clip was recorded in Normal face mode) */}
      {showPrivacyGuard && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Public feed privacy guardrail"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-sm rounded-[28px] border border-white/95 bg-white/90 p-5 text-slate-900 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center gap-2 text-amber-600">
              <ShieldAlert aria-hidden className="size-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Public Feed is Faceless</span>
            </div>
            <h3 className="mt-1.5 text-base font-bold">This clip was recorded in Normal mode</h3>
            <p className="mt-1 text-xs text-slate-600">
              Real-face snaps are great for private chats &amp; stories. To post on the public feed, choose an option:
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPrivacyGuard(false);
                  router.push('/chats');
                }}
                className="min-h-11 w-full rounded-full bg-slate-900 px-4 text-xs font-bold text-white shadow"
              >
                1. Send as Private Snap / Story
              </button>
              <button
                type="button"
                onClick={() => {
                  setPrivacyApproved(true);
                  setShowPrivacyGuard(false);
                }}
                className="min-h-11 w-full rounded-full border border-slate-300 bg-white px-4 text-xs font-bold text-slate-900"
              >
                2. Apply Auto Face-Blur &amp; Post Publicly
              </button>
              {onSwitchToMask && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPrivacyGuard(false);
                    onRetake();
                    onSwitchToMask();
                  }}
                  className="min-h-10 w-full rounded-full text-xs font-semibold text-violet-700"
                >
                  Retake in 3D Avatar Mask Mode
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPrivacyGuard(false)}
                className="mt-1 text-xs font-medium text-slate-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <PublishSheet
        buildInput={(expiryTier, isIncog) => {
          if (isNormalFace && !submit && !privacyApproved) {
            setShowPrivacyGuard(true);
            return null;
          }
          const snap = getSnap();
          return snap ? { kind: 'snap', payload: { ...snap, url: videoUrl, expiry: expiryTier }, expiryTier, isIncog } : null;
        }}
        onRetake={onRetake}
        onPublished={onPublished}
        submit={submit}
        submitLabel={submitLabel}
        downloadUrl={videoUrl}
        downloadName={`snap.${ext}`}
      />
    </section>
  );
}
