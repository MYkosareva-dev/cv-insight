import { redirect } from 'next/navigation';

import { getUser } from '@/lib/supabase/server';

/** `/` → member goes to /scan, visitor to /login (SPEC Block A, routes table). */
export default async function RootPage() {
  const user = await getUser();
  redirect(user ? '/scan' : '/login');
}
