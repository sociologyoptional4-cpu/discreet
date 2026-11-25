import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { LivingPostStudio } from '@/components/living/LivingPostStudio';

export const metadata: Metadata = { title: 'Create Living World' };
export const viewport: Viewport = { themeColor: '#000000', viewportFit: 'cover' };

export default function CreateLivingPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-[100dvh] w-full max-w-[430px] bg-black" />}>
      <LivingPostStudio />
    </Suspense>
  );
}
