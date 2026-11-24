'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  reaction?: string;
}

const STORAGE_KEY = 'vybe_ai_chat_v1';
const MAX_MESSAGES = 50;

const safeUuid = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function useAIChat() {
  const [messages, setMessages] = useState<AIMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AIMessage[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage errors
    }
    return [];
  });
  const [status, setStatus] = useState<'idle' | 'thinking' | 'streaming'>('idle');
  const hydrated = true;
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
    } catch {
      // Ignore quota errors
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || status !== 'idle') return;

    const userMsg: AIMessage = {
      id: safeUuid(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };

    const assistantId = safeUuid();
    const historySnapshot = [...messages, userMsg];

    setMessages(historySnapshot);
    setStatus('thinking');

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: historySnapshot.slice(-12).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let started = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;

        if (!started) {
          started = true;
          setStatus('streaming');
          setMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              role: 'assistant',
              content: accumulated,
              createdAt: Date.now(),
            },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)),
          );
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: 'assistant',
            content: 'Connection thoda drop ho gaya—ek baar dobara bhejoge?',
            createdAt: Date.now(),
          },
        ]);
      }
    } finally {
      setStatus('idle');
    }
  }, [messages, status]);

  const toggleReaction = useCallback((id: string, emoji: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, reaction: m.reaction === emoji ? undefined : emoji } : m,
      ),
    );
  }, []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStatus('idle');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }, []);

  return { messages, status, hydrated, sendMessage, toggleReaction, clearChat };
}
