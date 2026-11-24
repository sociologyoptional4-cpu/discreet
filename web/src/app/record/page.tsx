import type { Metadata, Viewport } from 'next';
import { PrivacyCamera } from '@/components/PrivacyCamera';

export const metadata: Metadata = { title: 'Record a snap' };
export const viewport: Viewport = { themeColor: '#0A0A0A', viewportFit: 'cover' };

export default function RecordPage() {
  return (
    <main className="flex h-dvh w-full items-center justify-center overflow-hidden bg-[#0A0A0A]">
      {/* As wide as the screen allows without the 9:16 frame ever exceeding the screen height. */}
      <div className="w-[min(100vw,calc(100dvh*9/16))]">
        <PrivacyCamera />
      </div>
    </main>
  );
}
