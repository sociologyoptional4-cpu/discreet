/**
 * Real-time WebGL2 video upscaler: Catmull-Rom upsampling followed by contrast-adaptive sharpening (CAS) at the
 * output resolution, the same two-step shape as AMD FSR1 (EASU + RCAS). Standalone: no React, no path aliases, no
 * app imports. Pure helpers are exported so they can run under `node --test`.
 *
 * It draws into a canvas that sits over a <video>. When anything is off (not a real upscale, a cross-origin video
 * the GPU may not read, dropped frames, a lost context) it bypasses itself and the native <video> shows through.
 */

export type UpscaleSource = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

export type BypassReason =
  | 'webgl2_unavailable'
  | 'shader_init_failed'
  | 'context_lost'
  | 'tainted'
  | 'upload_failed'
  | 'not_upscaling'
  | 'dropped_frames'
  | 'slow_upload';

export interface UpscalerOptions {
  /** 0 turns sharpening off (upsampling only), 1 is strongest. Default 0.5; 0.35-0.7 measured best, 1.0 over-sharpens. */
  sharpness?: number;
  /** Small S-curve contrast, 0..0.25. Default 0.04. */
  clarity?: number;
  /** Smallest source-to-screen scale worth upscaling. Below it the native <video> is already crisp. Default 1.4. */
  minScale?: number;
  /** Device pixel ratio cap for the output, to save battery. Default 2. */
  maxDpr?: number;
  /** 'bilinear' skips the Catmull-Rom pass (cheaper, softer). Default 'catmull'. */
  upsample?: 'catmull' | 'bilinear';
  /** A/B compare: the part left of this x (0..1) is upscaled, the rest is the native-looking bilinear. 1 = all upscaled. */
  split?: number;
  /** Ignore `minScale` (for A/B testing). */
  force?: boolean;
}

export interface UpscalerHooks {
  onFirstFrame?: () => void;
  onBypass?: (reason: BypassReason) => void;
}

export interface UpscalerStats {
  active: boolean;
  bypassReason: BypassReason | null;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  scale: number;
  framesRendered: number;
  uploadMsAvg: number;
}

/* ------------------------------------------------------------------ pure helpers */

/** UV window that makes a source cover a destination exactly like CSS `object-fit: cover` (centered). */
export function coverMapping(srcW: number, srcH: number, dstW: number, dstH: number): { scaleX: number; scaleY: number; offsetX: number; offsetY: number } {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  let scaleX = 1;
  let scaleY = 1;
  if (dstAspect > srcAspect) scaleY = srcAspect / dstAspect;
  else scaleX = dstAspect / srcAspect;
  return { scaleX, scaleY, offsetX: (1 - scaleX) / 2, offsetY: (1 - scaleY) / 2 };
}

/** How many output pixels one source pixel is stretched over when covering the destination. */
export function coverScale(srcW: number, srcH: number, dstW: number, dstH: number): number {
  return Math.max(dstW / srcW, dstH / srcH);
}

export function shouldUpscale(srcW: number, srcH: number, dstW: number, dstH: number, minScale: number): boolean {
  return srcW > 0 && srcH > 0 && coverScale(srcW, srcH, dstW, dstH) >= minScale;
}

/**
 * Whether WebGL may read this video. A cross-origin video without CORS makes `texImage2D` throw a SecurityError, so
 * it is checked first; `crossOrigin` must be set before the source loads.
 */
export function isReadableByWebGL(video: { currentSrc: string; crossOrigin: string | null }, pageOrigin: string): boolean {
  const src = video.currentSrc;
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return true;
  try {
    if (new URL(src, pageOrigin).origin === pageOrigin) return true;
  } catch {
    return false;
  }
  return video.crossOrigin === 'anonymous' || video.crossOrigin === 'use-credentials';
}

export interface FrameGuardConfig {
  /** Dropped / total frames in a window above this counts as a strike. Default 0.2. */
  maxDropRatio?: number;
  /** Windows with fewer frames than this are ignored. Default 12. */
  minFrames?: number;
  /** Average CPU time to hand a frame to the GPU, in ms, above which a window is a strike. Default 10. */
  maxUploadMs?: number;
  /** Consecutive strikes before the upscaler gives up. Default 2. */
  strikesToTrip?: number;
}

/**
 * Decides when the upscaler is hurting playback. Source frame rate does not matter: a 15 fps clip is judged by how
 * many of its own frames were dropped, not by a fixed fps floor.
 */
export class FrameGuard {
  private readonly maxDropRatio: number;
  private readonly minFrames: number;
  private readonly maxUploadMs: number;
  private readonly strikesToTrip: number;
  private strikes = 0;
  private uploadTotal = 0;
  private uploadCount = 0;

  constructor(config: FrameGuardConfig = {}) {
    this.maxDropRatio = config.maxDropRatio ?? 0.2;
    this.minFrames = config.minFrames ?? 12;
    this.maxUploadMs = config.maxUploadMs ?? 10;
    this.strikesToTrip = config.strikesToTrip ?? 2;
  }

  addUpload(ms: number): void {
    this.uploadTotal += ms;
    this.uploadCount += 1;
  }

  get uploadMsAvg(): number {
    return this.uploadCount === 0 ? 0 : this.uploadTotal / this.uploadCount;
  }

  /** Call once per window with the frames dropped and presented in it. Returns why to bypass, or null. */
  evaluate(droppedDelta: number, totalDelta: number): 'dropped_frames' | 'slow_upload' | null {
    const slow = this.uploadCount >= this.minFrames && this.uploadMsAvg > this.maxUploadMs;
    const dropping = totalDelta >= this.minFrames && droppedDelta / totalDelta > this.maxDropRatio;
    this.uploadTotal = 0;
    this.uploadCount = 0;
    this.strikes = slow || dropping ? this.strikes + 1 : 0;
    if (this.strikes < this.strikesToTrip) return null;
    return slow ? 'slow_upload' : 'dropped_frames';
  }
}

/* ------------------------------------------------------------------ shaders */

const VERTEX = `#version 300 es
precision highp float;
in vec2 a_pos;
uniform float u_flipY;
out vec2 v_uv;
void main() {
  float y = a_pos.y * 0.5 + 0.5;
  v_uv = vec2(a_pos.x * 0.5 + 0.5, mix(y, 1.0 - y, u_flipY));
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

/** Pass 1: crop like object-fit: cover and resample to the output size (Catmull-Rom, five bilinear taps). */
const UPSAMPLE = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_srcSize;
uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;
uniform float u_catmull;
in vec2 v_uv;
out vec4 outColor;

vec3 catmullRom(vec2 uv) {
  vec2 pos = uv * u_srcSize;
  vec2 p1 = floor(pos - 0.5) + 0.5;
  vec2 f = pos - p1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 p12 = (p1 + w2 / w12) / u_srcSize;
  vec2 p0 = (p1 - 1.0) / u_srcSize;
  vec2 p3 = (p1 + 2.0) / u_srcSize;
  vec3 c = texture(u_src, vec2(p12.x, p0.y)).rgb * (w12.x * w0.y)
         + texture(u_src, vec2(p0.x, p12.y)).rgb * (w0.x * w12.y)
         + texture(u_src, vec2(p12.x, p12.y)).rgb * (w12.x * w12.y)
         + texture(u_src, vec2(p3.x, p12.y)).rgb * (w3.x * w12.y)
         + texture(u_src, vec2(p12.x, p3.y)).rgb * (w12.x * w3.y);
  float wSum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return clamp(c / wSum, 0.0, 1.0);
}

void main() {
  vec2 uv = u_uvOffset + v_uv * u_uvScale;
  vec3 c = u_catmull > 0.5 ? catmullRom(uv) : texture(u_src, uv).rgb;
  outColor = vec4(c, 1.0);
}
`;

/**
 * Pass 2: contrast-adaptive sharpening on the upsampled image (sharpens real edges, leaves flat areas and noise
 * alone, no halos), a touch of clarity, and the optional split-screen A/B against plain bilinear.
 */
const SHARPEN = `#version 300 es
precision highp float;
uniform sampler2D u_up;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;
uniform float u_sharp;
uniform float u_clarity;
uniform float u_split;
in vec2 v_uv;
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  if (u_split < 0.999 && v_uv.x > u_split) {
    vec2 srcUv = u_uvOffset + vec2(v_uv.x, 1.0 - v_uv.y) * u_uvScale;
    outColor = vec4(texture(u_src, srcUv).rgb, 1.0);
    return;
  }
  vec3 c = texture(u_up, v_uv).rgb;
  if (u_sharp > 0.001) {
    vec3 n = texture(u_up, v_uv + vec2(0.0, -u_texel.y)).rgb;
    vec3 s = texture(u_up, v_uv + vec2(0.0,  u_texel.y)).rgb;
    vec3 e = texture(u_up, v_uv + vec2( u_texel.x, 0.0)).rgb;
    vec3 w = texture(u_up, v_uv + vec2(-u_texel.x, 0.0)).rgb;
    float lC = luma(c), lN = luma(n), lS = luma(s), lE = luma(e), lW = luma(w);
    float minL = min(lC, min(min(lN, lS), min(lE, lW)));
    float maxL = max(lC, max(max(lN, lS), max(lE, lW)));
    float amp = sqrt(clamp(min(minL, 1.0 - maxL) / max(maxL, 0.001), 0.0, 1.0));
    float weight = amp * (-1.0 / mix(8.0, 5.0, clamp(u_sharp, 0.0, 1.0)));
    c = clamp((c + (n + s + e + w) * weight) / (1.0 + 4.0 * weight), 0.0, 1.0);
  }
  if (u_clarity > 0.001) c = clamp(mix(c, c * c * (3.0 - 2.0 * c), u_clarity), 0.0, 1.0);
  if (u_split < 0.999 && abs(v_uv.x - u_split) < u_texel.x * 1.5) c = vec3(1.0);
  outColor = vec4(c, 1.0);
}
`;

type VideoRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: unknown) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

let supportCache: boolean | null = null;

/** Whether WebGL2 can be created here. The answer is cached (probing creates and discards a context). */
export function isWebGL2UpscalerSupported(): boolean {
  if (supportCache !== null) return supportCache;
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    supportCache = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supportCache = false;
  }
  return supportCache;
}

function dimensions(source: UpscaleSource): { width: number; height: number } {
  return 'videoWidth' in source ? { width: source.videoWidth, height: source.videoHeight } : { width: source.width, height: source.height };
}

const isVideo = (source: UpscaleSource): source is VideoRvfc => typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;

interface GlState {
  gl: WebGL2RenderingContext;
  upsample: WebGLProgram;
  sharpen: WebGLProgram;
  vao: WebGLVertexArrayObject;
  srcTex: WebGLTexture;
  upTex: WebGLTexture;
  fbo: WebGLFramebuffer;
  srcW: number;
  srcH: number;
  upW: number;
  upH: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'shader compile error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
  return program;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture failed');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

export class RealTimeVideoUpscaler {
  private readonly canvas: HTMLCanvasElement;
  private options: Required<UpscalerOptions>;
  private state: GlState | null = null;
  private source: UpscaleSource | null = null;
  private hooks: UpscalerHooks = {};
  private bypassReason: BypassReason | null = null;
  private running = false;
  private rvfc: number | null = null;
  private raf: number | null = null;
  private framesRendered = 0;
  private firstFrameSent = false;
  private readonly guard = new FrameGuard();
  private lastCheck = 0;
  private lastQuality = { dropped: 0, total: 0 };
  private cssW = 0;
  private cssH = 0;
  private resizeObserver: ResizeObserver | null = null;
  private lastOut = { width: 0, height: 0 };
  private readonly onLost = (event: Event) => {
    event.preventDefault();
    this.state = null;
    this.bypass('context_lost');
  };
  private readonly onRestored = () => {
    this.bypassReason = this.initGl() ? null : 'shader_init_failed';
  };

  constructor(canvas: HTMLCanvasElement, options: UpscalerOptions = {}) {
    this.canvas = canvas;
    this.options = { sharpness: 0.5, clarity: 0.04, minScale: 1.4, maxDpr: 2, upsample: 'catmull', split: 1, force: false, ...options };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box) { this.cssW = box.width; this.cssH = box.height; }
      });
      this.resizeObserver.observe(canvas);
    }
    if (!this.initGl()) this.bypassReason = this.bypassReason ?? 'shader_init_failed';
  }

  private initGl(): boolean {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'default' });
    if (!gl) {
      this.bypassReason = 'webgl2_unavailable';
      return false;
    }
    try {
      const upsample = link(gl, UPSAMPLE);
      const sharpen = link(gl, SHARPEN);
      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      const fbo = gl.createFramebuffer();
      if (!vao || !buffer || !fbo) throw new Error('resource allocation failed');
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.state = { gl, upsample, sharpen, vao, srcTex: texture(gl), upTex: texture(gl), fbo, srcW: 0, srcH: 0, upW: 0, upH: 0 };
      return true;
    } catch {
      this.state = null;
      this.bypassReason = 'shader_init_failed';
      return false;
    }
  }

  updateOptions(patch: UpscalerOptions): void {
    this.options = { ...this.options, ...patch };
  }

  get canRun(): boolean {
    return this.state !== null;
  }

  /** Starts drawing `source` into the canvas. Returns false when the upscaler cannot run at all. */
  attach(source: UpscaleSource, hooks: UpscalerHooks = {}): boolean {
    this.detach();
    if (!this.state) return false;
    this.source = source;
    this.hooks = hooks;
    this.bypassReason = null;
    this.firstFrameSent = false;
    this.framesRendered = 0;
    this.lastCheck = performance.now();
    this.lastQuality = { dropped: 0, total: 0 };
    this.running = true;
    if (isVideo(source)) this.schedule();
    return true;
  }

  detach(): void {
    this.running = false;
    if (this.rvfc !== null && this.source && isVideo(this.source)) this.source.cancelVideoFrameCallback?.(this.rvfc);
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.rvfc = null;
    this.raf = null;
    this.source = null;
  }

  private bypass(reason: BypassReason): void {
    this.bypassReason = reason;
    const notify = this.running;
    this.detach();
    if (notify) this.hooks.onBypass?.(reason);
  }

  private schedule(): void {
    const video = this.source;
    if (!this.running || !video || !isVideo(video)) return;
    const next = () => {
      this.renderNow();
      this.schedule();
    };
    if (video.requestVideoFrameCallback) this.rvfc = video.requestVideoFrameCallback(next);
    else this.raf = requestAnimationFrame(next);
  }

  private outputSize(): { width: number; height: number } {
    const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, this.options.maxDpr);
    const cssW = this.cssW || this.canvas.clientWidth;
    const cssH = this.cssH || this.canvas.clientHeight;
    return { width: Math.max(1, Math.round(cssW * dpr)), height: Math.max(1, Math.round(cssH * dpr)) };
  }

  /** Draws the current frame now. Called per video frame; tests call it directly on a canvas source. */
  renderNow(): void {
    const st = this.state;
    const source = this.source;
    if (!st || !source || !this.running) return;
    const { gl } = st;
    const src = dimensions(source);
    if (isVideo(source) && (source.readyState < 2 || src.width === 0)) return;
    if (src.width === 0 || src.height === 0) return;
    if (isVideo(source) && typeof location !== 'undefined' && !isReadableByWebGL(source, location.origin)) return this.bypass('tainted');

    const out = this.outputSize();
    if (this.canvas.width !== out.width || this.canvas.height !== out.height) {
      this.canvas.width = out.width;
      this.canvas.height = out.height;
    }
    if (!this.options.force && !shouldUpscale(src.width, src.height, out.width, out.height, this.options.minScale)) return this.bypass('not_upscaling');

    const t0 = performance.now();
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, st.srcTex);
      if (st.srcW !== src.width || st.srcH !== src.height) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        st.srcW = src.width;
        st.srcH = src.height;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
    } catch (error) {
      return this.bypass((error as { name?: string } | null)?.name === 'SecurityError' ? 'tainted' : 'upload_failed');
    }
    this.guard.addUpload(performance.now() - t0);

    if (st.upW !== out.width || st.upH !== out.height) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, st.upTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, out.width, out.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.upTex, 0);
      st.upW = out.width;
      st.upH = out.height;
    }

    const map = coverMapping(src.width, src.height, out.width, out.height);
    gl.bindVertexArray(st.vao);

    // pass 1: source -> output-sized texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(st.upsample);
    gl.uniform1f(gl.getUniformLocation(st.upsample, 'u_flipY'), 1);
    gl.uniform1i(gl.getUniformLocation(st.upsample, 'u_src'), 0);
    gl.uniform2f(gl.getUniformLocation(st.upsample, 'u_srcSize'), src.width, src.height);
    gl.uniform2f(gl.getUniformLocation(st.upsample, 'u_uvScale'), map.scaleX, map.scaleY);
    gl.uniform2f(gl.getUniformLocation(st.upsample, 'u_uvOffset'), map.offsetX, map.offsetY);
    gl.uniform1f(gl.getUniformLocation(st.upsample, 'u_catmull'), this.options.upsample === 'catmull' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // pass 2: sharpen to the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, out.width, out.height);
    gl.useProgram(st.sharpen);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, st.upTex);
    gl.uniform1f(gl.getUniformLocation(st.sharpen, 'u_flipY'), 0);
    gl.uniform1i(gl.getUniformLocation(st.sharpen, 'u_src'), 0);
    gl.uniform1i(gl.getUniformLocation(st.sharpen, 'u_up'), 1);
    gl.uniform2f(gl.getUniformLocation(st.sharpen, 'u_texel'), 1 / out.width, 1 / out.height);
    gl.uniform2f(gl.getUniformLocation(st.sharpen, 'u_uvScale'), map.scaleX, map.scaleY);
    gl.uniform2f(gl.getUniformLocation(st.sharpen, 'u_uvOffset'), map.offsetX, map.offsetY);
    gl.uniform1f(gl.getUniformLocation(st.sharpen, 'u_sharp'), this.options.sharpness);
    gl.uniform1f(gl.getUniformLocation(st.sharpen, 'u_clarity'), this.options.clarity);
    gl.uniform1f(gl.getUniformLocation(st.sharpen, 'u_split'), this.options.split);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    this.lastOut = out;

    this.framesRendered += 1;
    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      this.hooks.onFirstFrame?.();
    }
    if (isVideo(source)) this.checkHealth(source);
  }

  private checkHealth(video: HTMLVideoElement): void {
    const now = performance.now();
    if (now - this.lastCheck < 1000) return;
    this.lastCheck = now;
    const quality = video.getVideoPlaybackQuality?.();
    if (!quality || video.paused || video.readyState < 3) return;
    const droppedDelta = quality.droppedVideoFrames - this.lastQuality.dropped;
    const totalDelta = quality.totalVideoFrames - this.lastQuality.total;
    this.lastQuality = { dropped: quality.droppedVideoFrames, total: quality.totalVideoFrames };
    const verdict = this.guard.evaluate(droppedDelta, totalDelta);
    if (verdict) this.bypass(verdict);
  }

  getStats(): UpscalerStats {
    const src = this.source ? dimensions(this.source) : { width: 0, height: 0 };
    return {
      active: this.running && this.bypassReason === null,
      bypassReason: this.bypassReason,
      sourceWidth: src.width,
      sourceHeight: src.height,
      outputWidth: this.lastOut.width,
      outputHeight: this.lastOut.height,
      scale: src.width ? coverScale(src.width, src.height, this.lastOut.width || 1, this.lastOut.height || 1) : 0,
      framesRendered: this.framesRendered,
      uploadMsAvg: this.guard.uploadMsAvg,
    };
  }

  destroy(): void {
    this.detach();
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    const st = this.state;
    if (st) {
      const { gl } = st;
      gl.deleteTexture(st.srcTex);
      gl.deleteTexture(st.upTex);
      gl.deleteFramebuffer(st.fbo);
      gl.deleteProgram(st.upsample);
      gl.deleteProgram(st.sharpen);
      gl.deleteVertexArray(st.vao);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    this.state = null;
  }
}
