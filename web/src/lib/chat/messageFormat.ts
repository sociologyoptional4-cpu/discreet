/** Text helpers for chat bubbles: quoted replies and single-emoji detection. */

export const REACTION_EMOJIS = ['🔥', '😂', '❤️', '💀', '😮', '🥹'] as const;
export const ALL_EMOJIS = [...REACTION_EMOJIS, '👋', '🎉'] as const;

const QUOTE_PREFIX = '↪ ';
const QUOTE_MAX = 80;

/** Stores a reply as one quoted first line, so it needs no extra database column. */
export function encodeReply(quoted: string, text: string): string {
  const line = quoted.replace(/\s+/g, ' ').trim();
  const short = line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1)}…` : line;
  return `${QUOTE_PREFIX}${short}\n${text}`;
}

export function parseReply(content: string): { quote: string | null; body: string } {
  if (!content.startsWith(QUOTE_PREFIX)) return { quote: null, body: content };
  const newline = content.indexOf('\n');
  if (newline < 0) return { quote: null, body: content };
  return { quote: content.slice(QUOTE_PREFIX.length, newline), body: content.slice(newline + 1) };
}

/** True for one emoji (including skin tones, flags and ZWJ sequences), nothing else. */
export function isSingleEmoji(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)];
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(trimmed);
}
