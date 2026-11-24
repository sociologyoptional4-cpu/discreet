'use client';

import { useEffect, useRef } from 'react';

/** Small analyser-driven SVG trace. Audio remains in the existing recorder stream and is never sent to output. */
export function VoiceWaveform({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    if (!active || !stream || !path.current) return;
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const analyser = context.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.82;
    const source = context.createMediaStreamSource(stream); source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      analyser.getByteTimeDomainData(data);
      const points = Array.from({ length: 25 }, (_, i) => {
        const sample = data[Math.floor(i * (data.length - 1) / 24)] ?? 128;
        return { x: i * 4, y: 16 + (sample - 128) * 0.17 };
      });
      const d = points.map((p, i) => { if (i === 0) return `M ${p.x} ${p.y}`; const prev = points[i - 1]; return `Q ${(prev.x + p.x) / 2} ${(prev.y + p.y) / 2} ${p.x} ${p.y}`; }).join(' ');
      path.current?.setAttribute('d', d);
      raf = requestAnimationFrame(draw);
    };
    void context.resume().then(draw);
    return () => { cancelAnimationFrame(raf); source.disconnect(); void context.close(); };
  }, [active, stream]);
  return <svg aria-label={active ? 'Live voice level' : 'Voice waveform'} role="img" viewBox="0 0 96 32" className="h-8 w-24 overflow-visible"><path ref={path} d="M 0 16 Q 48 16 96 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={active ? 'text-indigo-500' : 'text-slate-300'} /></svg>;
}
