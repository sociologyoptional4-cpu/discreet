import type { Metadata, Viewport } from 'next';
import { PrivacyCamera } from '@/components/PrivacyCamera';

export const metadata: Metadata = { title: 'Record a snap' };
export const viewport: Viewport = { themeColor: '#F2F4F7', viewportFit: 'cover' };

export default function RecordPage() {
  return (
    <main className="relative mx-auto h-[100dvh] w-full max-w-[430px] overflow-hidden bg-[#0A0A0A]">
      <PrivacyCamera />
    </main>
  );
}
