'use client';
import { useRouter } from 'next/navigation';
import { PersonaCalibrator } from '@/components/PersonaCalibrator';

export default function PersonaPage() {
  const router = useRouter();
  return (
    <main className="bg-[#0A0A0A]">
      <PersonaCalibrator onClose={() => router.back()} />
    </main>
  );
}
