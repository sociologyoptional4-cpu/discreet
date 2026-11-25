import { NextRequest } from 'next/server';
import { getClientIp, optionalViewer, rateLimit } from '@/lib/server/request';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are Vybe AI, a warm, witty, grounded Gen-Z friend built into a faceless creator & review app.
- Mirror the user's language naturally (English, Hindi, or Hinglish).
- Keep replies punchy and conversational (2-4 sentences unless the user asks for a script, list, or detailed help).
- Never sound robotic, preachy, or overly formal.
- You can help users brainstorm 15-second faceless product review scripts, react to their mood, or just casually hang out and chat.`;

function streamSseText(
  upstreamBody: ReadableStream<Uint8Array>,
  extractText: (parsed: Record<string, unknown>) => string | undefined,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = upstreamBody.getReader();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr || jsonStr === '[DONE]') continue;
            try {
              const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
              const text = extractText(parsed);
              if (text) controller.enqueue(encoder.encode(text));
            } catch {
              // Ignore incomplete SSE JSON chunks
            }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const viewerId = await optionalViewer(req);
    const subject = viewerId ?? `ip:${getClientIp(req)}`;
    const limited = await rateLimit(subject, 'ai-chat');
    if (limited) return limited;

    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) {
      return new Response('Please send a message to start chatting.', { status: 400 });
    }

    const jarvisKey = process.env.JARVISLABS_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (jarvisKey) {
      const baseUrl = (process.env.JARVISLABS_BASE_URL || 'https://models.jarvislabs.net/v1').replace(/\/+$/, '');
      const model = process.env.JARVISLABS_MODEL || 'deepseek-v4.1-flash-1017';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jarvisKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.85,
          max_tokens: 512,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      });

      if (!res.ok || !res.body) {
        return new Response('Thoda network hiccup ho gaya, ek baar phir se bhejna!', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      const stream = streamSseText(res.body, (parsed) => {
        const choices = parsed.choices as { delta?: { content?: string } }[] | undefined;
        return choices?.[0]?.delta?.content;
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
      });
    }

    if (!geminiKey) {
      return new Response(
        'Vybe AI is taking a quick coffee break (missing AI API key). Add JARVISLABS_API_KEY or GEMINI_API_KEY in .env.local!',
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }

    const contents = messages.slice(-12).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { temperature: 0.85, maxOutputTokens: 512 },
        }),
      },
    );

    if (!geminiRes.ok || !geminiRes.body) {
      return new Response('Thoda network hiccup ho gaya, ek baar phir se bhejna!', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const stream = streamSseText(geminiRes.body, (parsed) => {
      const candidates = parsed.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
      return candidates?.[0]?.content?.parts?.[0]?.text;
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
    });
  } catch {
    return new Response('Something glitched on my end. Try again in a sec!', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
