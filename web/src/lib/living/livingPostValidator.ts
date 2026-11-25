export interface ValidationResult {
  ok: boolean;
  errors: string[];
  byteSize: number;
}

export interface ParsedLivingPostRecipe {
  livingHtmlUrl: string | null;
  inlineHtml: string | null;
  prompt: string;
  remixedFromPostId: string | null;
}

export const MAX_LIVING_POST_BYTES = 32 * 1024; // 32 KB max so every Living Post loads in < 20ms

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BANNED_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /<script\b[^>]*\btype\s*=\s*['"]?module\b/i,
    reason: 'ES module scripts (<script type="module">) are forbidden; use classic <script> only',
  },
  {
    pattern: /\bdocument\s*\.\s*cookie\b|\[['"`]cookie['"`]\]/i,
    reason: 'Access to document.cookie is forbidden',
  },
  {
    pattern: /\b(?:localStorage|sessionStorage|indexedDB|caches)\b|\[['"`](?:localStorage|sessionStorage|indexedDB)['"`]\]/i,
    reason: 'Web storage access is forbidden',
  },
  {
    pattern: /\bwindow\s*\.\s*(?:top|opener|open)\b|\b(?:parent|top)\s*\.\s*(?:document|frames|location)\b/i,
    reason: 'Parent DOM or window navigation access is forbidden',
  },
  {
    pattern: /\bfetch\s*\(|\b(?:XMLHttpRequest|WebSocket|EventSource|BroadcastChannel)\b|\b(?:SharedWorker|Worker)\s*\(|\bnavigator\s*\.\s*sendBeacon\b|\[['"`]fetch['"`]\]/i,
    reason: 'External network calls and background workers are forbidden',
  },
  {
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(|\bimport\s*\(|\bset(?:Timeout|Interval)\s*\(\s*['"`]/,
    reason: 'Dynamic code execution (eval/Function/dynamic import) is forbidden',
  },
  {
    pattern: /<(?:iframe|object|embed|applet|form|base)\b|<meta\b[^>]*http-equiv\s*=\s*['"]?refresh/i,
    reason: 'Nested frames, forms, base tags, or meta refresh are forbidden',
  },
  {
    pattern: /<script\b[^>]*\bsrc\s*=|\bhttps?:\/\/|(?:src|href)\s*=\s*['"]?\/\//i,
    reason: 'External URLs and remote scripts are forbidden',
  },
];

const MODULE_SYNTAX_RE =
  /(?:^|\n)\s*(?:import\s+(?:[\w*{]|['"])|export\s+(?:default|const|let|var|function|class|\{))/m;

export const STRICT_CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'">`;

/**
 * Injected ONLY inside Studio preview (never in `/feed`), forcing `preserveDrawingBuffer: true`
 * on WebGL contexts so `.webp` thumbnail capture never reads an empty cleared framebuffer.
 */
export const STUDIO_THUMB_HELPER = `<script data-vybe-injected="1">
(function(){
  if(window.__vybeThumbInit)return;
  window.__vybeThumbInit=1;
  var origGet=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,attrs){
    if(type==='webgl'||type==='webgl2'){
      attrs=Object.assign({},attrs,{preserveDrawingBuffer:true});
    }
    return origGet.call(this,type,attrs);
  };
  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='VYBE_CAPTURE_THUMB')return;
    var c=document.querySelector('canvas');
    if(!c||c.width===0||c.height===0){
      parent.postMessage({type:'VYBE_THUMB_RESULT',dataUrl:null},'*');
      return;
    }
    try{
      var maxW=480;
      var scale=c.width>maxW?(maxW/c.width):1;
      var tw=Math.max(1,Math.round(c.width*scale));
      var th=Math.max(1,Math.round(c.height*scale));
      var out=document.createElement('canvas');
      out.width=tw;
      out.height=th;
      var ctx=out.getContext('2d');
      var dataUrl=ctx?(ctx.drawImage(c,0,0,tw,th),out.toDataURL('image/webp',0.82)):c.toDataURL('image/webp',0.82);
      parent.postMessage({type:'VYBE_THUMB_RESULT',dataUrl:dataUrl},'*');
    }catch(_err){
      parent.postMessage({type:'VYBE_THUMB_RESULT',dataUrl:null},'*');
    }
  });
})();
</script>`;

/**
 * Injected into every Living Post `<head>`:
 * - Reports `VYBE_LIVING_READY` on first drawn animation frame.
 * - Kills runaway loops (> 50ms/frame for 5 consecutive frames) & reports `VYBE_LIVING_ERROR`.
 * - Runs a 500ms blank-screen & WebGL error probe.
 * - Handles `VYBE_TEARDOWN` on unmount to cancel rAF, close AudioContexts, and free WebGL contexts.
 */
export const FRAME_WATCHDOG_SCRIPT = `<script data-vybe-injected="1">
(function(){
  if(window.__vybeWatchdog)return;
  window.__vybeWatchdog=1;
  var origRAF=window.requestAnimationFrame.bind(window);
  var origCancel=window.cancelAnimationFrame.bind(window);
  var slowStrikes=0;
  var killed=false;
  var readySent=false;
  var lastRafId=0;
  var glList=[];
  var acList=[];

  var origGetCtx=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type,attrs){
    var ctx=origGetCtx.call(this,type,attrs);
    if(ctx&&(type==='webgl'||type==='webgl2')&&glList.indexOf(ctx)===-1){
      glList.push(ctx);
    }
    return ctx;
  };

  function wrapAC(name){
    var Orig=window[name];
    if(typeof Orig!=='function')return;
    window[name]=function(){
      var inst=new Orig();
      acList.push(inst);
      return inst;
    };
    window[name].prototype=Orig.prototype;
  }
  wrapAC('AudioContext');
  wrapAC('webkitAudioContext');

  window.requestAnimationFrame=function(cb){
    if(killed)return 0;
    lastRafId=origRAF(function(ts){
      if(killed)return;
      var start=performance.now();
      try{
        cb(ts);
      }catch(err){
        killed=true;
        parent.postMessage({type:'VYBE_LIVING_ERROR',error:String(err&&err.message?err.message:err)},'*');
        return;
      }
      var dur=performance.now()-start;
      if(!readySent){
        readySent=true;
        parent.postMessage({type:'VYBE_LIVING_READY'},'*');
      }
      if(dur>50){
        slowStrikes++;
        if(slowStrikes>=5){
          killed=true;
          parent.postMessage({type:'VYBE_LIVING_ERROR',error:'Frame budget exceeded ('+Math.round(dur)+'ms/frame)'},'*');
        }
      }else{
        slowStrikes=0;
      }
    });
    return lastRafId;
  };

  window.addEventListener('error',function(e){
    parent.postMessage({type:'VYBE_LIVING_ERROR',error:String(e.message||'Runtime error')},'*');
  });
  window.addEventListener('unhandledrejection',function(e){
    parent.postMessage({type:'VYBE_LIVING_ERROR',error:String(e.reason||'Unhandled promise rejection')},'*');
  });

  setTimeout(function(){
    if(killed)return;
    var canvas=document.querySelector('canvas');
    var svg=document.querySelector('svg');
    if(!canvas&&!svg){
      parent.postMessage({type:'VYBE_LIVING_ERROR',error:'Blank scene: no canvas or svg element'},'*');
      return;
    }
    if(canvas&&(canvas.width===0||canvas.height===0||canvas.clientWidth===0||canvas.clientHeight===0)){
      parent.postMessage({type:'VYBE_LIVING_ERROR',error:'Blank scene: canvas has 0x0 size'},'*');
      return;
    }
    for(var i=0;i<glList.length;i++){
      var gl=glList[i];
      if((typeof gl.isContextLost==='function'&&gl.isContextLost())||(typeof gl.getError==='function'&&gl.getError()!==gl.NO_ERROR)){
        parent.postMessage({type:'VYBE_LIVING_ERROR',error:'WebGL shader or context error'},'*');
        return;
      }
    }
    if(svg&&!canvas&&!readySent){
      readySent=true;
      parent.postMessage({type:'VYBE_LIVING_READY'},'*');
    }
  },500);

  window.addEventListener('message',function(e){
    if(!e.data||e.data.type!=='VYBE_TEARDOWN')return;
    killed=true;
    if(lastRafId)origCancel(lastRafId);
    for(var i=0;i<acList.length;i++){
      try{if(acList[i]&&typeof acList[i].close==='function')acList[i].close().catch(function(){});}catch(_e){}
    }
    for(var j=0;j<glList.length;j++){
      try{
        var ext=glList[j]&&glList[j].getExtension&&glList[j].getExtension('WEBGL_lose_context');
        if(ext)ext.loseContext();
      }catch(_e){}
    }
  });
})();
</script>`;

/**
 * Extracts non-empty inline `<script>` blocks from generated HTML.
 */
export function extractScriptBlocks(html: string): string[] {
  const blocks: string[] = [];
  const regex = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const code = match[1]?.trim();
    if (code) blocks.push(code);
  }
  return blocks;
}

/**
 * Unconditionally injects strict CSP `<meta>`, Frame-Budget Watchdog / Blank-Screen Probe / Teardown
 * listener, and (when `studioPreview: true`) WebGL `preserveDrawingBuffer` thumbnail capture helper.
 * Idempotent: strips any prior CSP meta or `data-vybe-injected="1"` scripts first.
 */
export function injectLivingPostSecurity(
  html: string,
  options?: { studioPreview?: boolean }
): string {
  const cleaned = html
    .trim()
    .replace(/<meta\b[^>]*http-equiv\s*=\s*['"]?Content-Security-Policy['"]?[^>]*>/gi, '')
    .replace(/<script\b[^>]*data-vybe-injected=['"]1['"][^>]*>[\s\S]*?<\/script>/gi, '');

  if (!cleaned) return '';

  const injection = `${STRICT_CSP_META}${options?.studioPreview ? STUDIO_THUMB_HELPER : ''}${FRAME_WATCHDOG_SCRIPT}`;
  if (/<head(?:\s[^>]*)?>/i.test(cleaned)) {
    return cleaned.replace(/<head(?:\s[^>]*)?>/i, (tag) => `${tag}\n${injection}`);
  }
  if (/<!doctype\s+html[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<!doctype\s+html[^>]*>/i, (tag) => `${tag}\n<head>${injection}</head>`);
  }
  return `<!DOCTYPE html>\n<html><head>${injection}</head><body>${cleaned}</body></html>`;
}

/** Convenience wrapper injecting production (`/feed`) security headers without Studio helpers. */
export function hardenLivingPostHtml(html: string): string {
  return injectLivingPostSecurity(html, { studioPreview: false });
}

/**
 * Validates safety, size, classic-script compliance, structure, and JS syntax of a Living Post.
 * Optionally accepts a `syntaxChecker` (e.g. `new vm.Script(code)` on the server).
 */
export function validateLivingPostHtml(
  html: string,
  syntaxChecker?: (jsCode: string) => void
): ValidationResult {
  const errors: string[] = [];
  const trimmed = html.trim();
  const byteSize = new TextEncoder().encode(trimmed).byteLength;

  if (!trimmed) {
    return { ok: false, errors: ['Empty HTML output'], byteSize: 0 };
  }

  if (byteSize > MAX_LIVING_POST_BYTES) {
    errors.push(`Payload too large (${byteSize} bytes > ${MAX_LIVING_POST_BYTES} bytes max)`);
  }

  if (!/<(?:canvas|svg)\b/i.test(trimmed)) {
    errors.push('Living Post must render a visual <canvas> or <svg> scene');
  }

  for (const { pattern, reason } of BANNED_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push(reason);
    }
  }

  const scripts = extractScriptBlocks(trimmed);
  if (scripts.length === 0) {
    errors.push('Missing interactive <script> block');
  }

  for (let i = 0; i < scripts.length; i++) {
    const code = scripts[i];
    if (MODULE_SYNTAX_RE.test(code)) {
      errors.push(`Script #${i + 1} uses ES module import/export syntax; use classic <script> IIFE only`);
    }
    if (syntaxChecker) {
      try {
        syntaxChecker(code);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`JavaScript syntax error in script #${i + 1}: ${msg}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, byteSize };
}

/** Verifies that a stored Living Post `.html` URL points to this app's R2 bucket over HTTPS. */
export function isTrustedLivingHtmlUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const base = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_R2_PUBLIC_URL : undefined;
    return url.hostname.endsWith('.r2.dev') || (!!base && url.hostname === new URL(base).hostname);
  } catch {
    return false;
  }
}

/**
 * Parses `recipe_data` for a `living_post`. Prefers R2 `livingHtmlUrl` (avoiding `/api/feed` JSONB bloat)
 * and falls back to inline `livingHtml` only when valid/safe.
 */
export function parseLivingPostRecipe(raw: unknown): ParsedLivingPostRecipe | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const livingHtmlUrl =
    typeof record.livingHtmlUrl === 'string' && isTrustedLivingHtmlUrl(record.livingHtmlUrl)
      ? record.livingHtmlUrl
      : null;

  let inlineHtml: string | null = null;
  if (typeof record.livingHtml === 'string' && record.livingHtml.trim().length > 0) {
    const secured = injectLivingPostSecurity(record.livingHtml, { studioPreview: false });
    if (validateLivingPostHtml(secured).ok) {
      inlineHtml = secured;
    } else if (!livingHtmlUrl) {
      return null;
    }
  }

  if (!livingHtmlUrl && !inlineHtml) return null;

  const prompt = typeof record.prompt === 'string' ? record.prompt.trim().slice(0, 500) : '';
  const remixedFromPostId =
    typeof record.remixedFromPostId === 'string' && UUID_RE.test(record.remixedFromPostId)
      ? record.remixedFromPostId
      : null;

  return { livingHtmlUrl, inlineHtml, prompt, remixedFromPostId };
}
