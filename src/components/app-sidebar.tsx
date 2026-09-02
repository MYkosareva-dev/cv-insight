'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Files, FolderKanban, ScanSearch, Settings } from 'lucide-react';

import { APP_NAME, NAV } from '@/lib/copy';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/scan', label: NAV.scan, Icon: ScanSearch },
  { href: '/career', label: NAV.career, Icon: FolderKanban },
  { href: '/applications', label: NAV.applications, Icon: Files },
  { href: '/quality', label: NAV.quality, Icon: Activity },
  { href: '/settings', label: NAV.settings, Icon: Settings },
] as const;

/**
 * Member shell navigation. Fixed 240 px rail at >= 768 px; a horizontal top bar
 * below that, so nothing overflows at 375 px (SPEC Block E).
 */
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="border-border bg-background flex shrink-0 gap-1 overflow-x-auto border-b p-3 md:h-screen md:w-60 md:flex-col md:overflow-x-visible md:border-r md:border-b-0 md:p-4"
    >
      <Link
        href="/scan"
        className="mr-2 hidden items-center gap-2 px-2 py-3 text-base font-semibold md:mr-0 md:flex"
      >
        <span
          aria-hidden
          className="size-5 rounded"
          style={{ background: 'var(--gradient-accent)' }}
        />
        {APP_NAME}
      </Link>

      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-md border-l-[3px] border-transparent px-3 py-2 text-sm whitespace-nowrap transition-colors',
              active ? 'bg-muted border-l-primary font-medium' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
