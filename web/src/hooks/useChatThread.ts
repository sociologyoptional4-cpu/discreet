'use client';
export { useChatEngine as useChatThread } from '@/hooks/useChatEngine';
export type { ChatMessage, DeliveryStatus } from '@/lib/chatMessages';
export type ChatThread = ReturnType<typeof import('@/hooks/useChatEngine').useChatEngine>;
