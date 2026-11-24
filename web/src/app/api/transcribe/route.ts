import { NextRequest, NextResponse } from 'next/server';

const DEEPGRAM_URL =
  'https://api.deepgram.com/v1/listen?model=nova-2&language=hi&smart_format=true&punctuate=true';
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

async function transcribeWithDeepgram(buffer: ArrayBuffer, mimeType: string, apiKey: string): Promise<string> {
  const res = await fetch(DEEPGRAM_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': mimeType || 'audio/webm',
    },
    body: buffer,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Deepgram responded ${res.status}`);
  const data = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (typeof transcript !== 'string') throw new Error('Deepgram returned no transcript');
  return transcript.trim();
}

async function transcribeWithGemini(buffer: ArrayBuffer, mimeType: string, apiKey: string): Promise<string> {
  const base64 = Buffer.from(buffer).toString('base64');
  const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Transcribe this audio accurately. The speaker may use Hindi, English, or Hinglish. Output ONLY the exact spoken text in clean Romanized Hinglish or English as spoken, with no extra commentary.',
            },
            {
              inline_data: {
                mime_type: mimeType || 'audio/webm',
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Gemini responded ${res.status}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini returned no transcript');
  return text;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('audio');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ error: 'No audio provided.' }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'Audio clip is too large.' }, { status: 413 });
    }

    const buffer = await file.arrayBuffer();
    const mimeType = (file.type || 'audio/webm').split(';')[0].trim();
    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (deepgramKey) {
      try {
        const transcript = await transcribeWithDeepgram(buffer, mimeType, deepgramKey);
        return NextResponse.json({ transcript });
      } catch {
        if (!geminiKey) {
          return NextResponse.json({ error: 'Transcription failed. Please try again.' }, { status: 502 });
        }
      }
    }

    if (geminiKey) {
      const transcript = await transcribeWithGemini(buffer, mimeType, geminiKey);
      return NextResponse.json({ transcript });
    }

    return NextResponse.json({ error: 'Speech-to-text is not configured.' }, { status: 503 });
  } catch {
    return NextResponse.json({ error: 'Could not transcribe audio.' }, { status: 500 });
  }
}
