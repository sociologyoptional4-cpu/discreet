import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'Search reviews' };
export const viewport: Viewport = { themeColor: '#0A0A0A', viewportFit: 'cover' };

export default function SearchLayout({ children }: LayoutProps<'/search'>) {
  return <main className="min-h-dvh bg-[#F2F4F7]">{children}</main>;
}
