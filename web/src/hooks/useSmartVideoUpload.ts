'use client';
import { useCallback, useEffect, useState } from 'react';
import { smartUploadQueue } from '@/lib/media/smartUploadQueue';
import type { UploadDraft } from '@/lib/media/optimisticUpload';

/** Thin React view of the background upload queue: the drafts, plus retry and cancel. */
export function useSmartVideoUpload() {
  const [drafts, setDrafts] = useState<UploadDraft[]>([]);
  useEffect(() => smartUploadQueue.subscribe(setDrafts), []);
  const retry = useCallback((id: string) => smartUploadQueue.retry(id), []);
  const cancel = useCallback((id: string) => void smartUploadQueue.cancel(id), []);
  return { drafts, retry, cancel };
}
