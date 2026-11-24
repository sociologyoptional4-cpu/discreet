'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowUp, Mic, MicOff, RotateCcw, Smile } from 'lucide-react';
import { Emoji3D, ReactionPill } from '@/components/chat/EmojiReactionSystem';
import { ALL_EMOJIS } from '@/lib/chat/messageFormat';
import { useAIChat } from '@/hooks/useAIChat';

const STARTER_CARDS = [
  '🎬 Help me script a 15s product review',
  '🔥 Give me a hot take to record',
  '😌 I just want to vent for a minute',
  '🎲 Play a quick 20-questions game',
];

type SpeechRecInstance = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results?: { 0?: { 0?: { transcript?: string } } } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
};

function AIChatInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { messages, status, hydrated, sendMessage, toggleReaction, clearChat } = useAIChat();

  const [input, setInput] = useState('');
  const [showEmojis, setShowEmojis] = useState(false);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported] = useState(() => {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as Record<string, unknown>;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const promptHandledRef = useRef(false);

  useEffect(() => {
    if (!hydrated || promptHandledRef.current) return;
    const initialPrompt = searchParams.get('prompt');
    if (initialPrompt) {
      promptHandledRef.current = true;
      void sendMessage(initialPrompt);
      router.replace('/chats/ai');
    }
  }, [hydrated, searchParams, sendMessage, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const handleVoiceToggle = () => {
    const w = window as unknown as Record<string, new () => SpeechRecInstance>;
    const SpeechRec = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SpeechRec) return;

    const recognition = new SpeechRec();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    setIsListening(true);

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const text = input;
    setInput('');
    void sendMessage(text);
  };

  return (
    <div className="relative flex min-h-[100dvh] w-full max-w-[430px] mx-auto flex-col bg-[#F2F4F7] text-[#111827] overflow-hidden">
      <div className="pointer-events-none fixed inset-0 max-w-[430px] mx-auto overflow-hidden">
        <div className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-violet-200/50 blur-3xl" />
        <div className="absolute top-1/3 -right-24 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl" />
        <div className="absolute bottom-10 left-10 h-60 w-60 rounded-full bg-amber-100/50 blur-3xl" />
      </div>

      <header className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-white/65 backdrop-blur-xl border-b border-white/80">
        <button
          onClick={() => router.push('/chats')}
          aria-label="Back to chats"
          className="h-10 w-10 rounded-full bg-white/80 border border-white shadow-sm flex items-center justify-center active:scale-95 transition"
        >
          <ArrowLeft className="h-5 w-5 text-slate-700" />
        </button>

        <div className="flex flex-col items-center">
          <span className="font-semibold text-[15px] text-[#111827]">Vybe AI</span>
          <span className="text-[11px] font-medium text-emerald-600">
            {status === 'thinking' ? 'Thinking...' : status === 'streaming' ? 'Typing...' : 'Online'}
          </span>
        </div>

        <button
          onClick={() => {
            if (messages.length > 0 && window.confirm('Clear this conversation?')) clearChat();
          }}
          aria-label="Clear chat"
          className="h-10 w-10 rounded-full bg-white/80 border border-white shadow-sm flex items-center justify-center active:scale-95 transition text-slate-600"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto px-4 py-5 space-y-3.5 pb-28">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center text-center pt-10">
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
              className="h-24 w-24 rounded-full bg-gradient-to-tr from-cyan-300 via-violet-300 to-rose-200 shadow-[0_18px_40px_rgba(124,108,255,0.28)] flex items-center justify-center mb-5"
            >
              <div className="h-9 w-14 rounded-full bg-[#181826] flex items-center justify-center gap-2.5 shadow-inner">
                <motion.span
                  animate={{ scaleY: [1, 0.12, 1] }}
                  transition={{ duration: 0.22, repeat: Infinity, repeatDelay: 3.2 }}
                  className="h-3.5 w-1.5 rounded-full bg-cyan-200"
                />
                <motion.span
                  animate={{ scaleY: [1, 0.12, 1] }}
                  transition={{ duration: 0.22, repeat: Infinity, repeatDelay: 3.2 }}
                  className="h-3.5 w-1.5 rounded-full bg-cyan-200"
                />
              </div>
            </motion.div>

            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Hey! What&apos;s on your mind?
            </h1>
            <p className="text-[13px] text-slate-500 mt-1 mb-6">
              Hinglish, Hindi, or English — I&apos;m always around.
            </p>

            <div className="grid grid-cols-1 gap-2.5 w-full">
              {STARTER_CARDS.map((prompt) => (
                <motion.button
                  key={prompt}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => void sendMessage(prompt)}
                  className="w-full text-left rounded-2xl bg-white/75 backdrop-blur-xl border border-white/95 px-4 py-3 text-[13.5px] font-medium text-slate-800 shadow-sm hover:bg-white transition"
                >
                  {prompt}
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    onClick={() => setReactingId((cur) => (cur === msg.id ? null : msg.id))}
                    onDoubleClick={() => toggleReaction(msg.id, '❤️')}
                    className={`relative max-w-[82%] cursor-pointer px-4 py-2.5 text-[14.5px] leading-relaxed select-none ${
                      isUser
                        ? 'rounded-[22px] rounded-br-md bg-gradient-to-tr from-indigo-500 to-sky-400 text-white shadow-md'
                        : 'rounded-[22px] rounded-bl-md bg-white/85 backdrop-blur-xl border border-white/95 text-[#111827] shadow-sm'
                    }`}
                  >
                    <AnimatePresence>
                      {reactingId === msg.id && (
                        <ReactionPill
                          align={isUser ? 'end' : 'start'}
                          onPick={(emoji) => {
                            toggleReaction(msg.id, emoji);
                            setReactingId(null);
                          }}
                          onClose={() => setReactingId(null)}
                        />
                      )}
                    </AnimatePresence>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.reaction && (
                      <span className="absolute -bottom-2.5 right-3 flex items-center justify-center rounded-full bg-white px-1.5 py-0.5 shadow border border-slate-100">
                        <Emoji3D emoji={msg.reaction} size={18} />
                      </span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        {status === 'thinking' && (
          <div className="flex justify-start">
            <div className="rounded-[22px] rounded-bl-md bg-white/80 backdrop-blur-xl border border-white px-4 py-3 flex items-center gap-1.5 shadow-sm">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  animate={{ y: [0, -4, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.14 }}
                  className="h-2 w-2 rounded-full bg-violet-400"
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <AnimatePresence>
        {showEmojis && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            className="fixed bottom-20 left-1/2 -translate-x-1/2 z-30 flex w-[calc(100%-24px)] max-w-[406px] flex-wrap justify-center gap-2 rounded-3xl border border-white/95 bg-white/85 p-3 shadow-[0_14px_34px_rgba(15,23,42,0.14)] backdrop-blur-2xl"
          >
            {ALL_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setInput((prev) => `${prev}${emoji}`);
                  setShowEmojis(false);
                }}
                aria-label={`Insert ${emoji}`}
                className="flex size-10 items-center justify-center rounded-full hover:bg-slate-100 active:scale-90 transition"
              >
                <Emoji3D emoji={emoji} size={28} />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <form
        onSubmit={handleSubmit}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-24px)] max-w-[406px] flex items-center gap-2 rounded-full bg-white/80 backdrop-blur-2xl border border-white/95 px-3 py-2 shadow-[0_12px_32px_rgba(15,23,42,0.10)]"
      >
        <button
          type="button"
          onClick={() => setShowEmojis((s) => !s)}
          aria-label="3D Emojis"
          aria-pressed={showEmojis}
          className={`h-9 w-9 rounded-full flex items-center justify-center transition ${
            showEmojis ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Smile className="h-4 w-4" />
        </button>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything..."
          className="flex-1 bg-transparent px-2 text-[14.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />

        {speechSupported && (
          <button
            type="button"
            onClick={handleVoiceToggle}
            aria-label="Voice input"
            className={`h-9 w-9 rounded-full flex items-center justify-center transition ${
              isListening
                ? 'bg-rose-500 text-white animate-pulse'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
        )}

        <button
          type="submit"
          disabled={!input.trim() || status !== 'idle'}
          aria-label="Send message"
          className="h-9 w-9 rounded-full bg-gradient-to-tr from-indigo-500 to-cyan-400 text-white flex items-center justify-center shadow-md disabled:opacity-40 active:scale-95 transition"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

export default function AIChatPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] bg-[#F2F4F7]" />}>
      <AIChatInner />
    </Suspense>
  );
}
