import type { Metadata } from 'next';

import { APP_NAME } from '@/lib/copy';

import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'AI resume tailoring grounded in your own career base.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
