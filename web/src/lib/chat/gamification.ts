/** Pure rules for chat streak tiers, relationship XP and the daily quest. Storage helpers are SSR-safe. */

export type StreakTier = 'none' | 'spark' | 'flame' | 'prism' | 'crown';

export const STREAK_TIER_META: Record<Exclude<StreakTier, 'none'>, { emoji: string; label: string }> = {
  spark: { emoji: '💠', label: 'Electric spark' },
  flame: { emoji: '🔥', label: 'Warm flame' },
  prism: { emoji: '🌈🔥', label: 'Prismatic flame' },
  crown: { emoji: '👑', label: 'Golden crown' },
};

export function streakTier(days: number): StreakTier {
  if (days >= 100) return 'crown';
  if (days >= 30) return 'prism';
  if (days >= 7) return 'flame';
  if (days >= 1) return 'spark';
  return 'none';
}

export const XP_REWARD = { message: 2, sticker: 2, snap: 10, streak: 20 } as const;
export type XpEvent = keyof typeof XP_REWARD;

export const LEVELS = [
  { level: 1, name: 'New Vibe', min: 0 },
  { level: 2, name: 'Mutuals', min: 60 },
  { level: 3, name: 'Besties', min: 250 },
  { level: 4, name: 'Inner Circle', min: 800 },
] as const;

export type LevelInfo = { level: number; name: string; min: number; next: number | null; progress: number };

export function levelFor(xp: number): LevelInfo {
  const safe = Math.max(0, Number.isFinite(xp) ? xp : 0);
  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) if (safe >= LEVELS[i].min) index = i;
  const current = LEVELS[index];
  const following = LEVELS[index + 1];
  const progress = following ? (safe - current.min) / (following.min - current.min) : 1;
  return { level: current.level, name: current.name, min: current.min, next: following?.min ?? null, progress: Math.min(1, Math.max(0, progress)) };
}

/** Local calendar day, e.g. "2026-11-25". */
export const dayKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The Monday that starts this date's week, as a day key; the streak shield resets on it. */
export function weekKey(date: Date): string {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return dayKey(monday);
}

export type QuestKind = 'snap' | 'message' | 'sticker';
export type Quest = { kind: QuestKind; goal: number; reward: number; label: string };

const QUESTS: readonly Quest[] = [
  { kind: 'snap', goal: 1, reward: 25, label: 'Send 1 Faceless Snap' },
  { kind: 'message', goal: 5, reward: 15, label: 'Send 5 messages' },
  { kind: 'sticker', goal: 2, reward: 20, label: 'Send 2 avatar stickers' },
];

/** The same quest all day for everyone; it rotates daily. */
export function questFor(day: string): Quest {
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return QUESTS[hash % QUESTS.length];
}

export type QuestState = { day: string; count: number; dismissed: boolean; claimed: boolean };
export type ChatProgress = { xp: number; streakDay: string | null };

const QUEST_KEY = 'vybe:quest';
const SHIELD_KEY = 'vybe:streak-shield';
const progressKey = (conversationId: string) => `vybe:chat-xp:${conversationId}`;

function read<T>(key: string, valid: (value: unknown) => value is T): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or full storage: progress stays in memory */ }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isProgress = (v: unknown): v is ChatProgress => isRecord(v) && typeof v.xp === 'number' && (v.streakDay === null || typeof v.streakDay === 'string');
const isQuestState = (v: unknown): v is QuestState => isRecord(v) && typeof v.day === 'string' && typeof v.count === 'number' && typeof v.dismissed === 'boolean' && typeof v.claimed === 'boolean';
const isString = (v: unknown): v is string => typeof v === 'string';

export const readProgress = (conversationId: string): ChatProgress => read(progressKey(conversationId), isProgress) ?? { xp: 0, streakDay: null };
export const writeProgress = (conversationId: string, value: ChatProgress): void => write(progressKey(conversationId), value);

export function readQuest(today: string): QuestState {
  const saved = read(QUEST_KEY, isQuestState);
  return saved && saved.day === today ? saved : { day: today, count: 0, dismissed: false, claimed: false };
}
/** Fired on window whenever quest progress changes, so open pills update. */
export const QUEST_EVENT = 'vybe:quest-change';
export function writeQuest(value: QuestState): void {
  write(QUEST_KEY, value);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUEST_EVENT));
}
/** A cheap string that changes whenever the stored quest or the day changes (for useSyncExternalStore). */
export const questSnapshot = (): string => `${dayKey(new Date())}|${typeof window === 'undefined' ? '' : window.localStorage.getItem(QUEST_KEY) ?? ''}`;

/** Counts an action toward today's quest; returns the reward when this action completes it, else 0. */
export function recordQuestAction(kind: QuestKind, now: Date = new Date()): number {
  const today = dayKey(now);
  const quest = questFor(today);
  const state = readQuest(today);
  if (quest.kind !== kind || state.claimed) return 0;
  const count = state.count + 1;
  const done = count >= quest.goal;
  writeQuest({ ...state, count, claimed: done });
  return done ? quest.reward : 0;
}

/** shortcut: the shield is tracked on this device only, so it shows availability; a server-side freeze needs a DB column. */
export const shieldAvailable = (now: Date = new Date()): boolean => read(SHIELD_KEY, isString) !== weekKey(now);
