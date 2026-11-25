import vm from 'node:vm';
import { generateLivingPost, type LLMCompleteFn, type LLMMessage } from '@/lib/living/recursiveAgent';
import { authenticate, json, rateLimit } from '@/lib/server/request';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PROMPT_CHARS = 500;
const MAX_PREV_HTML_CHARS = 45_000;
const MAX_RUNTIME_ERR_CHARS = 600;

function checkJsSyntax(jsCode: string): void {
  new vm.Script(jsCode, { filename: 'living-post.js' });
}

async function callJarvisLabs(messages: LLMMessage[]): Promise<string | null> {
  const apiKey = process.env.JARVISLABS_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.JARVISLABS_BASE_URL || 'https://models.jarvislabs.net/v1').replace(/\/+$/, '');
  const model = process.env.JARVISLABS_MODEL || 'deepseek-v4.1-flash-1017';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.65,
      max_tokens: 3600,
      messages,
    }),
    signal: AbortSignal.timeout(24_000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? null;
}

async function callGemini(messages: LLMMessage[]): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents,
        generationConfig: { temperature: 0.65, maxOutputTokens: 3600 },
      }),
      signal: AbortSignal.timeout(24_000),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

const completeWithFallback: LLMCompleteFn = async (messages) => {
  try {
    const primary = await callJarvisLabs(messages);
    if (primary) return primary;
  } catch {
    // Fall through to secondary provider
  }
  const secondary = await callGemini(messages);
  if (secondary) return secondary;
  throw new Error('AI code generator is temporarily unavailable.');
};

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const limited = await rateLimit(auth.userId, 'living-generate');
  if (limited) return limited;

  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const body = raw as Record<string, unknown>;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 3 || prompt.length > MAX_PROMPT_CHARS) {
    return json({ error: 'Prompt must be between 3 and 500 characters.' }, 400);
  }

  const previousHtml =
    typeof body.previousHtml === 'string' && body.previousHtml.length <= MAX_PREV_HTML_CHARS
      ? body.previousHtml
      : undefined;
  const runtimeError =
    typeof body.runtimeError === 'string' && body.runtimeError.trim().length > 0
      ? body.runtimeError.trim().slice(0, MAX_RUNTIME_ERR_CHARS)
      : undefined;

  if (!process.env.JARVISLABS_API_KEY && !process.env.GEMINI_API_KEY) {
    return json({ error: 'AI generation is not configured.' }, 503);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const result = await generateLivingPost(prompt, completeWithFallback, {
          maxAttempts: 2,
          previousHtml,
          runtimeError,
          syntaxChecker: checkJsSyntax,
          onStage: (ev) => send({ ...ev }),
        });

        send({
          stage: result.ok ? 'complete' : 'error',
          ok: result.ok,
          html: result.html,
          attempts: result.attempts,
          byteSize: result.validation.byteSize,
          errors: result.validation.errors,
        });
      } catch (err) {
        send({
          stage: 'error',
          ok: false,
          errors: [err instanceof Error ? err.message : 'Generation failed.'],
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
