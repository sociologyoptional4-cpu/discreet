'use client';

import { ArrowLeft, ArrowUp, Clock, Ghost, Infinity as InfinityIcon, Sparkles, Wand2, Wrench } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import LivingPostFrame, { captureLivingThumbnail } from '@/components/living/LivingPostFrame';
import { demoAddPost } from '@/lib/demoData';
import { LIVING_STARTER_PROMPTS, getInstantStarterHtml } from '@/lib/living/starterPresets';
import { randomIncogAlias } from '@/lib/publishPost';
import { uploadFiles } from '@/lib/r2Upload';
import { ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';
import type { ExpiryTier } from '@/types/privacy';

const EXPIRY_OPTIONS: { id: ExpiryTier; label: string }[] = [
  { id: '1d', label: '1D' },
  { id: '1w', label: '1W' },
  { id: '1y', label: '1Y' },
  { id: 'never', label: 'Never' },
];

type SseEvent = {
  stage?: string;
  attempt?: number;
  maxAttempts?: number;
  message?: string;
  ok?: boolean;
  html?: string;
  attempts?: number;
  byteSize?: number;
  errors?: string[];
  error?: string;
};

export function LivingPostStudio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPromptParam = searchParams.get('prompt')?.trim() ?? '';
  const remixPostId = searchParams.get('remixPostId')?.trim() || null;

  const firstPreset = LIVING_STARTER_PROMPTS[0];
  const [prompt, setPrompt] = useState(initialPromptParam || firstPreset.prompt);
  const [topic, setTopic] = useState(initialPromptParam ? '' : firstPreset.topic);
  const [html, setHtml] = useState<string>(() => firstPreset.buildHtml());
  const [metaBadge, setMetaBadge] = useState<string>('Instant Starter • Ready');
  const [generating, setGenerating] = useState(false);
  const [stageText, setStageText] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(0);
  const [expiry, setExpiry] = useState<ExpiryTier>('1d');
  const [incog, setIncog] = useState(false);
  const [refineMode, setRefineMode] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoHealedSignatureRef = useRef<string | null>(null);
  const hasGeneratedRef = useRef(false);

  const runAgent = useCallback(
    async (
      targetPrompt: string,
      heal?: { previousHtml: string; errorMsg: string },
    ) => {
      const clean = targetPrompt.trim();
      if (clean.length < 3) {
        setStatusError('Please describe the world in at least 3 characters.');
        return;
      }

      setGenerating(true);
      setStatusError(null);
      setRuntimeError(null);
      setStageText(
        heal
          ? heal.errorMsg.startsWith('User refinement request:')
            ? 'World refine ho raha hai...'
            : 'Bug auto-fix ho raha hai...'
          : 'World design ho raha hai...',
      );

      try {
        if (isDemoMode) {
          setHtml(getInstantStarterHtml('barish_shayari'));
          setMetaBadge('Demo Starter • Self-verified');
          setStageText(null);
          return;
        }

        const session = await ensureSession();
        const res = await fetch('/api/living/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            prompt: clean,
            previousHtml: heal?.previousHtml,
            runtimeError: heal?.errorMsg,
          }),
        });

        if (!res.ok) {
          const errJson = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errJson?.error ?? `Generation failed (${res.status})`);
        }
        if (!res.body) throw new Error('Missing SSE stream.');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalEvent: SseEvent | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            try {
              const evt = JSON.parse(trimmed.slice(5).trim()) as SseEvent;
              if (evt.message) setStageText(evt.message);
              if (evt.stage === 'complete' || evt.stage === 'error') {
                finalEvent = evt;
              }
            } catch {
              // Ignore partial SSE lines
            }
          }
        }

        if (!finalEvent?.ok || !finalEvent.html) {
          const errMsg = finalEvent?.errors?.[0] ?? finalEvent?.error ?? 'Could not generate a valid world.';
          throw new Error(errMsg);
        }

        hasGeneratedRef.current = true;
        setHtml(finalEvent.html);
        const kb = ((finalEvent.byteSize ?? finalEvent.html.length) / 1024).toFixed(1);
        setMetaBadge(
          `✨ Self-verified in ${finalEvent.attempts ?? 1} attempt${(finalEvent.attempts ?? 1) > 1 ? 's' : ''} • ${kb} KB`,
        );
        setStageText(null);
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : 'Generation failed.');
        setStageText(null);
      } finally {
        setGenerating(false);
      }
    },
    [],
  );

  // Auto-generate when arriving from a Remix link with ?prompt=
  useEffect(() => {
    if (!initialPromptParam || hasGeneratedRef.current) return;
    hasGeneratedRef.current = true;
    void runAgent(initialPromptParam);
  }, [initialPromptParam, runAgent]);

  const handleRuntimeError = useCallback(
    (err: string) => {
      setRuntimeError(err);
      const sig = `${html.length}:${err}`;
      if (!generating && autoHealedSignatureRef.current !== sig && hasGeneratedRef.current) {
        autoHealedSignatureRef.current = sig;
        void runAgent(prompt, { previousHtml: html, errorMsg: err });
      }
    },
    [generating, html, prompt, runAgent],
  );

  const selectStarter = (id: string) => {
    const preset = LIVING_STARTER_PROMPTS.find((p) => p.id === id);
    if (!preset) return;
    setPrompt(preset.prompt);
    setTopic(preset.topic);
    setHtml(preset.buildHtml());
    setRuntimeError(null);
    setStatusError(null);
    setMetaBadge(`${preset.emoji} Instant Starter • Ready`);
  };

  const publish = async () => {
    if (publishing || generating || !html) return;
    setPublishing(true);
    setPublishProgress(0.05);
    setStatusError(null);

    try {
      const cleanTopic = topic.trim().slice(0, 120) || prompt.trim().slice(0, 60) || 'living world';
      const cleanPrompt = prompt.trim().slice(0, 500);

      if (isDemoMode) {
        demoAddPost({
          topic: cleanTopic,
          mode: 'noface',
          avatarId: null,
          mediaUrl: 'https://vybe.app/living-post',
          motion: null,
          durationSec: 15,
          isIncog: incog,
          alias: incog ? randomIncogAlias() : null,
        });
        router.push('/feed?posted=1');
        return;
      }

      const session = await ensureSession();
      const tier: ExpiryTier = incog ? '1d' : expiry;

      const thumbBlob = await captureLivingThumbnail(iframeRef.current, 700);
      const htmlBlob = new Blob([html], { type: 'text/plain' });

      const files = [
        { blob: htmlBlob, contentType: 'text/plain', fileName: 'living-world.txt' },
        ...(thumbBlob
          ? [{ blob: thumbBlob, contentType: thumbBlob.type || 'image/webp', fileName: 'living-thumb.webp' }]
          : []),
      ];

      const targets = await uploadFiles(session.access_token, files, 'post', tier, (fraction) => {
        setPublishProgress(0.1 + fraction * 0.8);
      });

      const livingHtmlUrl = targets[0]?.publicUrl;
      const thumbnailUrl = targets[1]?.publicUrl ?? null;
      if (!livingHtmlUrl) throw new Error('Missing public URL for Living Post HTML.');

      const postId = safeRandomUUID();
      const { error } = await supabase.from('posts').insert({
        id: postId,
        user_id: session.user.id,
        mode: 'noface',
        post_format: 'living_post',
        topic_entity: cleanTopic,
        avatar_id: null,
        media_url: thumbnailUrl ?? livingHtmlUrl,
        thumbnail_url: thumbnailUrl,
        motion_url: null,
        duration_sec: 15,
        is_incog: incog,
        incog_alias: incog ? randomIncogAlias() : null,
        expiry_tier: tier,
        recipe_data: {
          kind: 'living_post',
          version: 1,
          livingHtmlUrl,
          prompt: cleanPrompt,
          remixedFromPostId: remixPostId,
        },
      });

      if (error) {
        throw new Error(
          error.message.includes('permanent posts')
            ? 'Free accounts keep up to 5 permanent posts. Pick a shorter expiry.'
            : 'Could not publish your Living Post. Try again.',
        );
      }

      setPublishProgress(1);
      void fetch('/api/brain/embed-post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ postId }),
        keepalive: true,
      }).catch(() => {});
      router.push('/feed?posted=1');
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Publish failed.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <main className="relative mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-black text-white">
      {/* Live Interactive Sandboxed Canvas */}
      <div className="relative flex-1 overflow-hidden">
        <LivingPostFrame
          html={html}
          isActive
          studioPreview
          onIframeElement={(el) => {
            iframeRef.current = el;
          }}
          onRuntimeError={handleRuntimeError}
        />

        {/* Top Bar */}
        <div className="pointer-events-none absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="pointer-events-auto flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur-xl"
          >
            <ArrowLeft aria-hidden className="size-4" />
          </button>

          <span className="rounded-full border border-white/20 bg-black/55 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur-xl">
            {metaBadge}
          </span>
        </div>

        {/* SSE Live Stage Banner */}
        {stageText && (
          <div className="pointer-events-none absolute inset-x-4 top-20 z-20 flex justify-center">
            <div className="flex items-center gap-2 rounded-full border border-violet-400/40 bg-black/75 px-4 py-1.5 text-xs font-semibold text-violet-200 shadow-lg backdrop-blur-xl">
              <Sparkles aria-hidden className="size-3.5 animate-pulse text-violet-300" />
              <span>{stageText}</span>
            </div>
          </div>
        )}

        {/* Runtime Auto-Heal / Error Banner */}
        {(runtimeError || statusError) && (
          <div className="absolute inset-x-4 bottom-3 z-20 flex flex-col items-center gap-2">
            <div className="flex w-full items-center justify-between gap-2 rounded-2xl border border-rose-400/40 bg-black/80 px-3 py-2 text-xs text-rose-200 backdrop-blur-xl">
              <span className="line-clamp-2 flex-1">{runtimeError ?? statusError}</span>
              {runtimeError && (
                <button
                  type="button"
                  disabled={generating}
                  onClick={() => void runAgent(prompt, { previousHtml: html, errorMsg: runtimeError })}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-rose-500 px-3 py-1 font-bold text-white disabled:opacity-50"
                >
                  <Wrench aria-hidden className="size-3" />
                  Auto-Fix
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Studio Controls */}
      <section className="z-30 flex flex-col gap-2.5 border-t border-white/10 bg-zinc-950/95 px-3 pb-[max(0.9rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        {/* 1-Tap Starters */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {LIVING_STARTER_PROMPTS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={generating || publishing}
              onClick={() => selectStarter(preset.id)}
              className="flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90 transition hover:bg-white/20 disabled:opacity-50"
            >
              <span>{preset.emoji}</span>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>

        {/* Refine Toggle */}
        {html && (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={refineMode}
              disabled={generating || publishing}
              onClick={() => setRefineMode((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
                refineMode
                  ? 'border-violet-400 bg-violet-500/25 text-violet-200'
                  : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <Sparkles aria-hidden className="size-3" />
              <span>Refine current world</span>
            </button>
          </div>
        )}

        {/* Prompt Input + Generate Button */}
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={500}
            placeholder="Describe your interactive world in Hinglish or English..."
            className="min-h-[44px] flex-1 resize-none rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs text-white placeholder:text-white/45 focus:border-violet-400 focus:outline-none"
          />
          <button
            type="button"
            disabled={generating || publishing}
            onClick={() =>
              void runAgent(
                prompt,
                refineMode && html
                  ? { previousHtml: html, errorMsg: `User refinement request: ${prompt.trim()}` }
                  : undefined,
              )
            }
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 text-xs font-bold text-white shadow-lg disabled:opacity-50"
          >
            <Wand2 aria-hidden className="size-4" />
            {generating ? 'Coding...' : refineMode ? 'Refine' : 'Generate'}
          </button>
        </div>

        {/* Topic + Expiry + Incog + Publish Row */}
        <div className="flex items-center justify-between gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={80}
            placeholder="#topic"
            aria-label="Topic tag"
            className="h-9 min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-3 text-xs text-white placeholder:text-white/40 focus:outline-none"
          />

          {!incog && (
            <button
              type="button"
              onClick={() => {
                const idx = EXPIRY_OPTIONS.findIndex((o) => o.id === expiry);
                setExpiry(EXPIRY_OPTIONS[(idx + 1) % EXPIRY_OPTIONS.length].id);
              }}
              aria-label="Cycle expiry"
              className="flex h-9 items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2.5 text-[11px] font-bold"
            >
              {expiry === 'never' ? <InfinityIcon aria-hidden className="size-3.5" /> : <Clock aria-hidden className="size-3.5" />}
              <span>{EXPIRY_OPTIONS.find((o) => o.id === expiry)?.label}</span>
            </button>
          )}

          <button
            type="button"
            aria-pressed={incog}
            aria-label="Incog Burner"
            onClick={() => setIncog((v) => !v)}
            className={`flex size-9 items-center justify-center rounded-full border transition ${
              incog ? 'border-violet-400 bg-violet-500/30 text-violet-200' : 'border-white/15 bg-white/10 text-white/75'
            }`}
          >
            <Ghost aria-hidden className="size-4" />
          </button>

          <button
            type="button"
            disabled={publishing || generating}
            onClick={() => void publish()}
            className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-xs font-extrabold text-slate-950 shadow disabled:opacity-50"
          >
            <ArrowUp aria-hidden className="size-3.5" />
            {publishing ? `${Math.round(publishProgress * 100)}%` : 'Publish'}
          </button>
        </div>
      </section>
    </main>
  );
}
