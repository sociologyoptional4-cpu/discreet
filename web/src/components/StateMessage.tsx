import Link from 'next/link';
import type { ReactNode } from 'react';

type Props = { light?: boolean; title: string; body?: string; action?: { href: string; label: string }; children?: ReactNode };

/** Centered full-height message used for loading, empty and error states on the dark screens. */
export function StateMessage({ light = false, title, body, action, children }: Props) {
  return (
    <div role="status" className={`flex min-h-[calc(100dvh-var(--nav-h))] flex-col items-center justify-center gap-3 px-8 text-center ${light ? 'text-slate-900' : 'bg-[#0A0A0A] text-white'}`}>
      <h1 className="text-lg font-semibold">{title}</h1>
      {body && <p className={`max-w-xs text-sm ${light ? 'text-slate-500' : 'text-white/70'}`}>{body}</p>}
      {children}
      {action && (
        <Link href={action.href} className={`min-h-11 rounded-full px-5 py-2.5 text-sm font-semibold ${light ? 'bg-slate-900 text-white' : 'bg-white text-[#0A0A0A]'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
