import type { Metadata } from 'next';
import { WelcomeOrbit } from '@/components/WelcomeOrbit';

export const metadata: Metadata = { title: { absolute: 'Vybe' } };

export default function Home() {
  return <WelcomeOrbit />;
}
