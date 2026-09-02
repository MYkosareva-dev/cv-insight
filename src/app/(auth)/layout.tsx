import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="border-border w-full max-w-[400px] rounded-lg border p-6 shadow-sm">
        {children}
      </div>
      <Link href="/privacy" className="text-muted-foreground text-xs underline-offset-4 hover:underline">
        Privacy
      </Link>
    </div>
  );
}
