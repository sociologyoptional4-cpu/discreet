import { injectLivingPostSecurity } from './livingPostValidator.ts';

export interface LivingStarterPreset {
  id: string;
  label: string;
  emoji: string;
  prompt: string;
  topic: string;
  buildHtml: () => string;
}

const BARISH_SHAYARI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100vw;height:100vh;overflow:hidden;background:#050816;font-family:system-ui,-apple-system,sans-serif;user-select:none}
  canvas{display:block;width:100%;height:100%;touch-action:none}
  #hint{position:fixed;bottom:18%;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.12);backdrop-filter:blur(8px);color:#e2e8f0;font-size:12px;font-weight:600;pointer-events:none;transition:opacity .5s}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="hint">Tap anywhere for bijli &amp; shayari</div>
<script>
(function(){
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const hint = document.getElementById('hint');
  let w = 0, h = 0, dpr = 1, flash = 0, coupletIdx = 0;
  const lines = [
    'Bheegi raat, aur chamakti bijli...',
    'Har boond mein ek adhoori shayari hai.',
    'Khamosh aasmaan bhi aaj bol pada,',
    'Tere naam ki baarish phir baras padi.'
  ];
  const drops = Array.from({length: 110}, () => ({
    x: Math.random(), y: Math.random(), len: 14 + Math.random()*22, spd: 0.012 + Math.random()*0.015
  }));
  const ripples = [];
  const texts = [];
  const bolts = [];

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function spawnLightning(x, y){
    flash = 0.85;
    ripples.push({x, y, r: 6, a: 1});
    texts.push({x: Math.min(w-40, Math.max(40, x)), y: Math.min(h*0.72, Math.max(90, y-24)), text: lines[coupletIdx % lines.length], a: 1, vy: -0.45});
    coupletIdx++;
    const segs = [{x: x + (Math.random()-0.5)*80, y: 0}];
    let cy = 0, cx = segs[0].x;
    while(cy < y){
      cy += 24 + Math.random()*26;
      cx += (Math.random()-0.5)*44;
      segs.push({x: cx, y: Math.min(cy, y)});
    }
    bolts.push({segs, a: 1});
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ac = new AC();
        if (ac.state === 'suspended') ac.resume();
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(140, ac.currentTime);
        o.frequency.exponentialRampToValueAtTime(42, ac.currentTime + 0.35);
        g.gain.setValueAtTime(0.08, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.38);
        o.connect(g); g.connect(ac.destination);
        o.start(); o.stop(ac.currentTime + 0.4);
      }
    } catch(_e){}
  }

  c.addEventListener('pointerdown', (e) => {
    hint.style.opacity = '0';
    spawnLightning(e.clientX, e.clientY);
  });

  function loop(){
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#070b1e');
    grad.addColorStop(1, '#111834');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (flash > 0.01) {
      ctx.fillStyle = 'rgba(186,230,253,' + (flash * 0.32).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
      flash *= 0.88;
    }

    ctx.strokeStyle = 'rgba(125,211,252,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const d of drops) {
      const px = d.x * w, py = d.y * h;
      ctx.moveTo(px, py);
      ctx.lineTo(px - 2, py + d.len);
      d.y += d.spd;
      if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
    }
    ctx.stroke();

    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      ctx.strokeStyle = 'rgba(224,242,254,' + b.a.toFixed(2) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      b.segs.forEach((p, idx) => idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
      b.a *= 0.86;
      if (b.a < 0.04) bolts.splice(i, 1);
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      ctx.strokeStyle = 'rgba(56,189,248,' + rp.a.toFixed(2) + ')';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r * 1.4, rp.r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      rp.r += 3.2; rp.a *= 0.95;
      if (rp.a < 0.03) ripples.splice(i, 1);
    }

    ctx.textAlign = 'center';
    ctx.font = '600 17px Georgia, serif';
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      ctx.fillStyle = 'rgba(248,250,252,' + t.a.toFixed(2) + ')';
      ctx.fillText(t.text, w / 2, t.y);
      t.y += t.vy;
      t.a *= 0.988;
      if (t.a < 0.04) texts.splice(i, 1);
    }

    requestAnimationFrame(loop);
  }
  spawnLightning(w * 0.5, h * 0.48);
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;

const WISH_LANTERNS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100vw;height:100vh;overflow:hidden;background:#090514}
  canvas{display:block;width:100%;height:100%;touch-action:none}
  #hint{position:fixed;bottom:18%;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.12);color:#fef3c7;font:600 12px system-ui,sans-serif;pointer-events:none;transition:opacity .5s}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="hint">Tap sky to release a wish lantern</div>
<script>
(function(){
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const hint = document.getElementById('hint');
  let w = 0, h = 0, dpr = 1, t = 0;
  const stars = Array.from({length: 85}, () => ({x: Math.random(), y: Math.random()*0.72, r: 0.7+Math.random()*1.6, p: Math.random()*6.28}));
  const lanterns = [];

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function addLantern(x, y){
    lanterns.push({x, y, s: 14 + Math.random()*10, vy: 0.7 + Math.random()*0.6, sway: Math.random()*6.28});
  }
  for (let i = 0; i < 6; i++) addLantern(w*(0.2+i*0.12), h*(0.35+Math.random()*0.35));

  c.addEventListener('pointerdown', (e) => {
    hint.style.opacity = '0';
    addLantern(e.clientX, e.clientY);
  });

  function loop(){
    t += 0.025;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#09051a');
    g.addColorStop(0.75, '#1e1035');
    g.addColorStop(1, '#0c0818');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (const s of stars) {
      const a = 0.35 + 0.55 * Math.abs(Math.sin(t + s.p));
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(s.x*w, s.y*h, s.r, 0, Math.PI*2);
      ctx.fill();
    }

    for (let i = lanterns.length - 1; i >= 0; i--) {
      const l = lanterns[i];
      l.y -= l.vy;
      l.x += Math.sin(t + l.sway) * 0.35;
      const glow = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.s*2.6);
      glow.addColorStop(0, 'rgba(253,224,71,0.95)');
      glow.addColorStop(0.45, 'rgba(249,115,22,0.45)');
      glow.addColorStop(1, 'rgba(249,115,22,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(l.x, l.y, l.s*2.6, 0, Math.PI*2); ctx.fill();

      ctx.fillStyle = '#fb923c';
      ctx.fillRect(l.x - l.s*0.42, l.y - l.s*0.58, l.s*0.84, l.s*1.1);
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(l.x - l.s*0.26, l.y - l.s*0.35, l.s*0.52, l.s*0.65);

      if (l.y < -60) lanterns.splice(i, 1);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;

const CYBER_HOLI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100vw;height:100vh;overflow:hidden;background:#09090b}
  canvas{display:block;width:100%;height:100%;touch-action:none}
  #hint{position:fixed;bottom:18%;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;font:600 12px system-ui,sans-serif;pointer-events:none;transition:opacity .5s}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="hint">Swipe or tap for neon gulaal burst</div>
<script>
(function(){
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const hint = document.getElementById('hint');
  let w = 0, h = 0, dpr = 1, down = false;
  const colors = ['#ec4899','#22d3ee','#a855f7','#facc15','#4ade80'];
  const pts = [];

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function burst(x, y, n){
    const col = colors[Math.floor(Math.random()*colors.length)];
    for (let i = 0; i < n; i++) {
      const ang = Math.random()*Math.PI*2;
      const spd = 1.5 + Math.random()*6;
      pts.push({x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, r: 3+Math.random()*5, c: col, a: 1});
    }
  }
  burst(w*0.5, h*0.48, 36);

  c.addEventListener('pointerdown', (e) => { down = true; hint.style.opacity = '0'; burst(e.clientX, e.clientY, 26); });
  c.addEventListener('pointermove', (e) => { if (down) burst(e.clientX, e.clientY, 7); });
  window.addEventListener('pointerup', () => { down = false; });

  function loop(){
    ctx.fillStyle = 'rgba(9,9,11,0.16)';
    ctx.fillRect(0, 0, w, h);
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.96; p.vy = p.vy * 0.96 + 0.04;
      p.a *= 0.965;
      ctx.globalAlpha = p.a;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
      if (p.a < 0.04) pts.splice(i, 1);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;

const CHAI_LOFI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100vw;height:100vh;overflow:hidden;background:#0f172a}
  canvas{display:block;width:100%;height:100%;touch-action:none}
  #hint{position:fixed;bottom:18%;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.12);color:#e2e8f0;font:600 12px system-ui,sans-serif;pointer-events:none;transition:opacity .5s}
</style>
</head>
<body>
<canvas id="c"></canvas>
<div id="hint">Tap orbs to play lo-fi synth chords</div>
<script>
(function(){
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const hint = document.getElementById('hint');
  let w = 0, h = 0, dpr = 1, t = 0, ac = null;
  const notes = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
  const orbs = notes.map((freq, idx) => ({
    freq, rx: 0.22 + (idx % 3) * 0.28, ry: 0.34 + Math.floor(idx / 3) * 0.26, pulse: 0, phase: idx * 1.1
  }));

  function resize(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function playNote(freq){
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ac) ac = new AC();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, ac.currentTime);
      g.gain.setValueAtTime(0.11, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.9);
      o.connect(g); g.connect(ac.destination);
      o.start(); o.stop(ac.currentTime + 0.95);
    } catch(_e){}
  }

  c.addEventListener('pointerdown', (e) => {
    hint.style.opacity = '0';
    let best = orbs[0], bestD = Infinity;
    for (const o of orbs) {
      const d = Math.hypot(o.rx * w - e.clientX, o.ry * h - e.clientY);
      if (d < bestD) { bestD = d; best = o; }
    }
    best.pulse = 1;
    playNote(best.freq);
  });

  function loop(){
    t += 0.02;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(1, '#311042');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    for (const o of orbs) {
      const x = o.rx * w + Math.sin(t + o.phase) * 8;
      const y = o.ry * h + Math.cos(t * 0.9 + o.phase) * 10;
      const r = 34 + o.pulse * 26;
      const gr = ctx.createRadialGradient(x, y, 4, x, y, r * 1.8);
      gr.addColorStop(0, 'rgba(244,114,182,0.95)');
      gr.addColorStop(0.6, 'rgba(139,92,246,0.35)');
      gr.addColorStop(1, 'rgba(139,92,246,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
      o.pulse *= 0.92;
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
</script>
</body>
</html>`;

export const LIVING_STARTER_PROMPTS: ReadonlyArray<LivingStarterPreset> = [
  {
    id: 'barish_shayari',
    label: 'Barish + Bijli + Shayari',
    emoji: '⛈️',
    prompt: 'Barish + Bijli + Shayari: moody monsoon raindrops, tap anywhere for lightning flash, ripples, and glowing Hinglish shayari couplets',
    topic: 'barish shayari world',
    buildHtml: () => injectLivingPostSecurity(BARISH_SHAYARI_HTML, { studioPreview: false }),
  },
  {
    id: 'wish_lanterns',
    label: 'Wish Lanterns',
    emoji: '🏮',
    prompt: 'Midnight Starfield + Wish Lanterns: twinkling stars, tap anywhere in the sky to release warm glowing floating lanterns',
    topic: 'wish lanterns sky',
    buildHtml: () => injectLivingPostSecurity(WISH_LANTERNS_HTML, { studioPreview: false }),
  },
  {
    id: 'cyber_holi',
    label: 'Cyber Holi Neon',
    emoji: '🎨',
    prompt: 'Cyber Holi Neon Splash: zero-gravity neon gulaal particle bursts and glowing trails wherever you tap or swipe',
    topic: 'cyber holi neon',
    buildHtml: () => injectLivingPostSecurity(CYBER_HOLI_HTML, { studioPreview: false }),
  },
  {
    id: 'chai_lofi',
    label: 'Lo-Fi Synth Orbs',
    emoji: '🎧',
    prompt: 'Rainy Window + Lo-Fi Synth Pads: floating neon orbs that pulse and play warm pentatonic synth chords when tapped',
    topic: 'lofi synth pads',
    buildHtml: () => injectLivingPostSecurity(CHAI_LOFI_HTML, { studioPreview: false }),
  },
];

export function getInstantStarterHtml(presetId: string): string {
  const found = LIVING_STARTER_PROMPTS.find((p) => p.id === presetId) ?? LIVING_STARTER_PROMPTS[0];
  return found.buildHtml();
}
