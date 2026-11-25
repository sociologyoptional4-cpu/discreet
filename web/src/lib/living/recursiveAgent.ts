import {
  injectLivingPostSecurity,
  validateLivingPostHtml,
  type ValidationResult,
} from './livingPostValidator.ts';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type LLMCompleteFn = (messages: LLMMessage[]) => Promise<string>;

export type LivingAgentStage = 'generating' | 'validating' | 'healing' | 'complete' | 'error';

export interface LivingStageEvent {
  stage: LivingAgentStage;
  attempt: number;
  maxAttempts: number;
  message: string;
  errors?: string[];
}

export interface RecursiveAgentResult {
  ok: boolean;
  html: string;
  attempts: number;
  validation: ValidationResult;
}

const SYSTEM_PROMPT = `You are Vybe's Living Post Creative Coder.
Generate a SINGLE self-contained HTML5 document (inline CSS + classic inline JS, zero external network requests or CDNs) that creates a stunning, mobile-first (9:16 portrait, 100vw x 100vh, overflow: hidden) interactive micro-world.

STRICT RULES:
1. Use HTML5 <canvas> (2D or WebGL) with a smooth requestAnimationFrame loop and touch/pointer interactivity (pointerdown, pointermove, or hold).
2. Classic <script> IIFE ONLY: NEVER use <script type="module">, import, or export statements.
3. Output ONLY raw HTML starting with <!DOCTYPE html> — no markdown fences, no explanations.
4. Keep total size compact (under 20 KB).
5. NEVER use fetch, XMLHttpRequest, WebSocket, localStorage, sessionStorage, document.cookie, eval, Function(), <iframe, or any http:// / https:// URLs.
6. Mobile 60fps performance: cap devicePixelRatio at 2, handle window resize cleanly, keep particle counts <= 180 so each frame renders under 8ms, set touch-action: none on the canvas, and show a subtle hint like "Tap or drag" that fades out after first interaction.
7. iOS Safari WebAudio rule: if the prompt includes sound effects (rain, thunder, synth), create AudioContext lazily inside pointerdown/touchstart inside try/catch, and ALWAYS call if (audioCtx.state === 'suspended') audioCtx.resume(); before playing.`;

/**
 * Strips markdown code fences and any non-HTML preamble/postscript around an HTML document.
 */
export function extractHtmlDocument(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  const doctypeIdx = candidate.search(/<!doctype\s+html/i);
  const htmlIdx = doctypeIdx >= 0 ? doctypeIdx : candidate.search(/<html\b/i);
  if (htmlIdx >= 0) {
    const endIdx = candidate.search(/<\/html>/i);
    return endIdx >= htmlIdx ? candidate.slice(htmlIdx, endIdx + 7).trim() : candidate.slice(htmlIdx).trim();
  }
  return candidate;
}

/**
 * Recursive Generate -> Validate -> Inject Security -> Self-Heal loop (default `maxAttempts = 2`).
 */
export async function generateLivingPost(
  userPrompt: string,
  complete: LLMCompleteFn,
  options?: {
    maxAttempts?: number;
    previousHtml?: string;
    runtimeError?: string;
    syntaxChecker?: (jsCode: string) => void;
    onStage?: (event: LivingStageEvent) => void;
  }
): Promise<RecursiveAgentResult> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 2);
  const messages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Create an interactive Living Post for: ${userPrompt.trim()}` },
  ];

  // Support client-reported runtime / blank-screen / frame-budget self-healing
  if (options?.previousHtml && options?.runtimeError) {
    messages.push(
      { role: 'assistant', content: options.previousHtml },
      {
        role: 'user',
        content: `The previous code failed in the browser preview:\n${options.runtimeError}\nFix the bug cleanly and return ONLY the complete corrected <!DOCTYPE html> document.`,
      }
    );
  }

  let lastHtml = '';
  let lastValidation: ValidationResult = { ok: false, errors: ['Not run'], byteSize: 0 };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    options?.onStage?.({
      stage: 'generating',
      attempt,
      maxAttempts,
      message:
        attempt === 1
          ? 'World design ho raha hai...'
          : `Bug auto-fix ho raha hai (Attempt ${attempt}/${maxAttempts})...`,
    });

    const raw = await complete(messages);
    const extracted = extractHtmlDocument(raw);

    options?.onStage?.({
      stage: 'validating',
      attempt,
      maxAttempts,
      message: 'Code & security verify ho raha hai...',
    });

    const rawValidation = validateLivingPostHtml(extracted, options?.syntaxChecker);
    const secured = injectLivingPostSecurity(extracted, { studioPreview: false });
    const securedValidation = rawValidation.ok
      ? validateLivingPostHtml(secured, options?.syntaxChecker)
      : rawValidation;

    lastHtml = secured || extracted;
    lastValidation = securedValidation;

    if (securedValidation.ok) {
      return {
        ok: true,
        html: secured,
        attempts: attempt,
        validation: securedValidation,
      };
    }

    if (attempt < maxAttempts) {
      options?.onStage?.({
        stage: 'healing',
        attempt,
        maxAttempts,
        message: 'Issue mila, AI khud fix kar raha hai...',
        errors: securedValidation.errors,
      });
    }

    messages.push(
      { role: 'assistant', content: extracted },
      {
        role: 'user',
        content: `Your output failed validation with these errors:\n- ${securedValidation.errors.join('\n- ')}\nFix every issue and return ONLY the corrected <!DOCTYPE html> document.`,
      }
    );
  }

  return {
    ok: false,
    html: lastHtml,
    attempts: maxAttempts,
    validation: lastValidation,
  };
}
