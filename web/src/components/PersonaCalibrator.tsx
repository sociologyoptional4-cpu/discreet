'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CameraOff, Check, Hand, LoaderCircle, Smile, Wind, X } from 'lucide-react';
import type { FaceLandmarker, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { useCameraStream } from '@/hooks/useCameraStream';
import { extractMotionFrame, hasTrackedFace } from '@/lib/avatarRetargeter';
import { disposeMediaPipe, getFaceLandmarker, getHandLandmarker } from '@/lib/mediapipe';
import { MOTION_FPS } from '@/lib/motionPack';
import { analyzeCalibrationFrames } from '@/lib/personaAnalyzer';
import { ensureSession } from '@/lib/session';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { PERSONA_LIMITS, type PersonaStyle } from '@/types/persona';
import type { MotionFrame } from '@/types/avatar';

const CLIP_SECONDS = 5;
const FRAME_MS = 1000 / MOTION_FPS;
const HAND_EVERY_N_FRAMES = 2;
const MIN_FACE_FRAMES = 60; // about 2 of the 5 seconds with the face tracked, or the clip is asked to be redone
const PROGRESS_TICK_MS = 100;

const STEPS = [
  { label: 'Say hi', prompt: 'Say hi naturally and relax your shoulders' },
  { label: 'Get excited', prompt: 'Explain something you’re excited about using your hands' },
  { label: 'Disagree', prompt: 'Disagree with a bad product review' },
] as const;

type ModelsState = 'loading' | 'ready' | 'error';
type SaveState = { phase: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

export type PersonaCalibratorProps = {
  /** Called after the persona is saved to the profile. */
  onSaved?: (style: PersonaStyle) => void;
  onClose?: () => void;
};

const unit = (v: number, min: number, max: number): number => Math.min(1, Math.max(0, (v - min) / (max - min)));

/**
 * Three 5-second prompts, tracked on the phone. Only numbers (head angles, face weights, wrist positions) are kept;
 * no video or audio is recorded or uploaded. The numbers are boiled down to a ~1 KB PersonaStyle and saved to the profile.
 */
export function PersonaCalibrator({ onSaved, onClose }: PersonaCalibratorProps) {
  const { videoRef, phase: camPhase, retry: retryCamera } = useCameraStream({ audio: false });
  const [models, setModels] = useState<ModelsState>('loading');
  const [modelsAttempt, setModelsAttempt] = useState(0);
  const [step, setStep] = useState(0);
  const [clips, setClips] = useState<MotionFrame[][]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clipError, setClipError] = useState<string | null>(null);
  const [result, setResult] = useState<{ style: PersonaStyle; handsSeen: boolean } | null>(null);
  const [save, setSave] = useState<SaveState>({ phase: 'idle' });

  // The 30 FPS tracking loop reads and writes only refs, so it never triggers a React render.
  const modelsRef = useRef<{ face: FaceLandmarker; hand: HandLandmarker } | null>(null);
  const recordingRef = useRef(false);
  const framesRef = useRef<MotionFrame[]>([]);
  const startedAtRef = useRef(0);
  const timersRef = useRef<{ stop: ReturnType<typeof setTimeout> | null; tick: ReturnType<typeof setInterval> | null }>({ stop: null, tick: null });
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    Promise.all([getFaceLandmarker(), getHandLandmarker()])
      .then(([face, hand]) => {
        if (cancelled) return;
        modelsRef.current = { face, hand };
        setModels('ready');
      })
      .catch(() => { if (!cancelled) setModels('error'); });
    return () => {
      cancelled = true;
      modelsRef.current = null;
    };
  }, [modelsAttempt]);

  useEffect(() => {
    if (models !== 'ready' || camPhase !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let lastRun = 0;
    let lastTs = 0;
    let count = 0;
    let hands: HandLandmarkerResult | null = null;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastRun < FRAME_MS - 2) return;
      lastRun = now;
      const m = modelsRef.current;
      if (!m || !recordingRef.current || video.readyState < 2 || !video.videoWidth) return;
      const ts = Math.max(performance.now(), lastTs + 1); // MediaPipe needs strictly increasing timestamps
      lastTs = ts;
      try {
        const face = m.face.detectForVideo(video, ts);
        if (!hands || count % HAND_EVERY_N_FRAMES === 0) hands = m.hand.detectForVideo(video, ts);
        count += 1;
        if (!hasTrackedFace(face)) return; // frames without a face say nothing about the head or expressions
        const t = (performance.now() - startedAtRef.current) / 1000;
        framesRef.current.push(extractMotionFrame(face, hands, t));
      } catch {
        /* one bad frame is skipped */
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [models, camPhase, videoRef]);

  const clearTimers = useCallback(() => {
    const t = timersRef.current;
    if (t.stop) clearTimeout(t.stop);
    if (t.tick) clearInterval(t.tick);
    t.stop = t.tick = null;
  }, []);

  useEffect(() => () => {
    clearTimers();
    recordingRef.current = false;
    void disposeMediaPipe();
  }, [clearTimers]);

  const finishClip = () => {
    clearTimers();
    recordingRef.current = false;
    setRecording(false);
    const frames = framesRef.current;
    framesRef.current = [];
    if (frames.length < MIN_FACE_FRAMES) {
      setClipError('We couldn’t see your face clearly. Keep it in the frame with good light, then record this clip again.');
      return;
    }
    const all = [...clips.slice(0, step), frames];
    setClips(all);
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    const merged = all.flat();
    setResult({ style: analyzeCalibrationFrames(merged), handsSeen: merged.some((f) => f.leftHand || f.rightHand) });
  };
  useEffect(() => { finishRef.current = finishClip; });

  const startClip = () => {
    if (recordingRef.current || models !== 'ready' || camPhase !== 'ready') return;
    framesRef.current = [];
    startedAtRef.current = performance.now();
    recordingRef.current = true;
    setClipError(null);
    setElapsed(0);
    setRecording(true);
    timersRef.current.tick = setInterval(() => setElapsed(Math.min(CLIP_SECONDS, (performance.now() - startedAtRef.current) / 1000)), PROGRESS_TICK_MS);
    timersRef.current.stop = setTimeout(() => finishRef.current(), CLIP_SECONDS * 1000);
  };

  const redo = () => {
    setResult(null);
    setClips([]);
    setStep(0);
    setClipError(null);
    setSave({ phase: 'idle' });
  };

  const savePersona = async () => {
    if (!result || save.phase === 'saving') return;
    if (!isSupabaseConfigured) {
      setSave({ phase: 'error', message: 'The backend is not set up yet. Add your Supabase keys to .env.local.' });
      return;
    }
    setSave({ phase: 'saving' });
    try {
      const session = await ensureSession();
      const { data, error } = await supabase.from('users').update({ persona_style: result.style }).eq('id', session.user.id).select('id');
      if (error || !data || data.length === 0) throw new Error('save failed');
      setSave({ phase: 'saved' });
      onSaved?.(result.style);
    } catch {
      setSave({ phase: 'error', message: 'Could not save your persona. Try again.' });
    }
  };

  const camReady = camPhase === 'ready';
  const canRecord = camReady && models === 'ready' && !recording;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 bg-[#0A0A0A] px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] text-white">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Persona calibration</h1>
          <p className="text-xs text-white/60">Three 5-second clips. Nothing is recorded or uploaded, only your movement numbers.</p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 focus-visible:outline-2 focus-visible:outline-violet-400">
            <X aria-hidden className="size-5" />
          </button>
        )}
      </header>

      {/* The same element feeds MediaPipe; once the result shows it is parked off-screen but keeps playing for a redo. */}
      <div className={result ? 'pointer-events-none absolute left-0 top-0 size-px overflow-hidden opacity-0' : 'relative aspect-[3/4] w-full overflow-hidden rounded-3xl border border-white/15 bg-black'}>
        <video ref={videoRef} playsInline muted autoPlay aria-label="Your camera, shown only to you" className="size-full -scale-x-100 object-cover" />
        {recording && (
          <div role="progressbar" aria-label="Clip progress" aria-valuemin={0} aria-valuemax={CLIP_SECONDS} aria-valuenow={Math.round(elapsed)} className="absolute inset-x-3 top-3 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-100 ease-linear motion-reduce:transition-none" style={{ width: `${(elapsed / CLIP_SECONDS) * 100}%` }} />
          </div>
        )}
        {camPhase === 'requesting' && <Overlay icon={<LoaderCircle aria-hidden className="size-7 animate-spin motion-reduce:animate-none" />} text="Starting camera…" />}
        {camPhase === 'denied' && <Overlay icon={<CameraOff aria-hidden className="size-7" />} text="Camera blocked. Allow it for this site, then try again." action={() => void retryCamera()} />}
        {(camPhase === 'unsupported' || camPhase === 'error') && <Overlay icon={<CameraOff aria-hidden className="size-7" />} text={camPhase === 'unsupported' ? 'Camera needs a secure (https) page.' : 'Couldn’t start the camera.'} action={camPhase === 'error' ? () => void retryCamera() : undefined} />}
        {camReady && models === 'loading' && <Overlay icon={<LoaderCircle aria-hidden className="size-7 animate-spin motion-reduce:animate-none" />} text="Loading face and hand tracking…" />}
        {camReady && models === 'error' && <Overlay icon={<CameraOff aria-hidden className="size-7" />} text="Tracking models failed to load." action={() => { setModels('loading'); setModelsAttempt((n) => n + 1); }} />}
      </div>

      {result ? (
        <PersonaCard style={result.style} handsSeen={result.handsSeen} save={save} onSave={() => void savePersona()} onRedo={redo} />
      ) : (
        <>
          <ol className="flex items-center gap-2" aria-label="Calibration steps">
            {STEPS.map((s, i) => (
              <li key={s.label} aria-current={i === step ? 'step' : undefined} className={`flex flex-1 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold ${i < step ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100' : i === step ? 'border-white/40 bg-white/15 text-white' : 'border-white/10 text-white/45'}`}>
                {i < step ? <Check aria-hidden className="size-3.5 shrink-0" /> : <span aria-hidden className="tabular-nums">{i + 1}</span>}
                <span className="truncate">{s.label}</span>
              </li>
            ))}
          </ol>

          <div aria-live="polite" className="rounded-3xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur-xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Clip {step + 1} of {STEPS.length}</p>
            <p className="mt-1 text-lg font-semibold leading-snug">{STEPS[step].prompt}</p>
            {recording && <p className="mt-2 text-sm text-white/70">Recording… {Math.max(0, Math.ceil(CLIP_SECONDS - elapsed))}s</p>}
            {clipError && <p role="alert" className="mt-2 text-sm text-rose-300">{clipError}</p>}
          </div>

          <button
            type="button"
            onClick={startClip}
            disabled={!canRecord}
            className="min-h-12 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-400 text-sm font-bold text-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
          >
            {recording ? 'Recording…' : clipError ? 'Record this clip again' : `Start clip ${step + 1}`}
          </button>
        </>
      )}
    </div>
  );
}

function Overlay({ icon, text, action }: { icon: ReactNode; text: string; action?: () => void }) {
  return (
    <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0A0A0A]/85 px-6 text-center text-sm backdrop-blur-sm">
      {icon}
      <p className="max-w-xs text-white/85">{text}</p>
      {action && <button type="button" onClick={action} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-violet-400">Try again</button>}
    </div>
  );
}

function PersonaCard({ style, handsSeen, save, onSave, onRedo }: { style: PersonaStyle; handsSeen: boolean; save: SaveState; onSave: () => void; onRedo: () => void }) {
  const speed = PERSONA_LIMITS.handSpeedMultiplier;
  const face = PERSONA_LIMITS.expressionGain;
  const energy = style.handSpeedMultiplier < 0.9 ? 'Calm' : style.handSpeedMultiplier < 1.3 ? 'Balanced' : 'Animated';
  const expressiveness = style.expressionGain < 0.95 ? 'Reserved' : style.expressionGain < 1.2 ? 'Natural' : 'Expressive';
  const hand = style.dominantHand === 'both' ? 'Both hands' : style.dominantHand === 'left' ? 'Left hand' : 'Right hand';

  return (
    <>
      <section aria-labelledby="dna-heading" className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <h2 id="dna-heading" className="text-lg font-bold">Your Persona DNA</h2>
        <dl className="mt-4 flex flex-col gap-4">
          <Trait icon={<Hand aria-hidden className="size-5" />} name="Dominant Hand" value={hand} />
          <Trait icon={<Wind aria-hidden className="size-5" />} name="Gesture Energy" value={energy} meter={unit(style.handSpeedMultiplier, 0.6, 1.8)} detail={`${style.handSpeedMultiplier.toFixed(2)}× (range ${speed.min}–${speed.max})`} />
          <Trait icon={<Smile aria-hidden className="size-5" />} name="Expressiveness" value={expressiveness} meter={unit(style.expressionGain, 0.8, 1.5)} detail={`${style.expressionGain.toFixed(2)}× (range ${face.min}–${face.max})`} />
        </dl>
        {!handsSeen && <p className="mt-4 rounded-2xl bg-amber-500/15 px-3 py-2 text-xs text-amber-100">We didn’t see your hands, so Gesture Energy and Dominant Hand are neutral. Redo with your hands in view for a better match.</p>}
      </section>

      {save.phase === 'error' && <p role="alert" className="rounded-2xl bg-rose-500/20 px-3 py-2 text-sm text-rose-100">{save.message}</p>}
      {save.phase === 'saved' && <p role="status" className="rounded-2xl bg-emerald-500/20 px-3 py-2 text-sm text-emerald-100">Saved. Your avatar will move like you.</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onRedo} disabled={save.phase === 'saving'} className="min-h-12 rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-violet-400 disabled:opacity-50">Redo</button>
        <button type="button" onClick={onSave} disabled={save.phase === 'saving' || save.phase === 'saved'} className="min-h-12 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-400 text-sm font-bold text-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60">
          {save.phase === 'saving' ? 'Saving…' : save.phase === 'saved' ? 'Saved' : 'Save to my profile'}
        </button>
      </div>
    </>
  );
}

function Trait({ icon, name, value, meter, detail }: { icon: ReactNode; name: string; value: string; meter?: number; detail?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-violet-300">{icon}</span>
      <div className="flex-1">
        <dt className="text-xs text-white/60">{name}</dt>
        <dd className="text-base font-semibold">{value}</dd>
        {meter !== undefined && (
          <div role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter * 100)} aria-valuetext={`${value}${detail ? `, ${detail}` : ''}`} className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" style={{ width: `${Math.max(4, meter * 100)}%` }} />
          </div>
        )}
        {detail && <p className="mt-1 text-[11px] text-white/50">{detail}</p>}
      </div>
    </div>
  );
}
