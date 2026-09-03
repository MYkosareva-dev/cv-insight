Source: https://github.com/supabase/supabase/blob/master/examples/auth/nextjs-full/app/login/actions.ts

# signInWithPassword and signOut

Fetched via Context7 from `/supabase/supabase` and `/supabase/ssr`.
Content below is pasted as returned. Annotations are ours.

> **ANNOTATION (applies to this whole file):** CLAUDE.md overrides anything in
> these docs. Especially **Authentication rule 1**: Supabase Auth handles all sign-in and session
> handling — no custom password handling of any kind, no hashing, no comparison, no
> homemade tokens. The only password code in this project is the string handed to
> `signInWithPassword`.

---

## signIn & signUp Server Actions

Source: https://github.com/supabase/supabase/blob/master/examples/auth/nextjs-full/app/login/actions.ts

Next.js Server Actions for email/password sign in and sign up using createServerClient with the anon key (no service role). When email confirmation is enabled, signUp returns user without session; when disabled, it returns a valid session.

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    redirect('/error')
  }

  revalidatePath('/', 'layout')
  redirect('/')
}

export async function signUp(formData: FormData) {
  const supabase = await createClient()

  // type-casting here for convenience
  // in practice, you should validate your inputs
  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signUp(data)

  if (error) {
    redirect('/error')
  }

  revalidatePath('/', 'layout')
  redirect('/')
}
```

> **ANNOTATION — `as string` is not allowed here.** The snippet says so itself ("in
> practice, you should validate your inputs"), and under `strict: true` with no `any`
> (and no unchecked casts) we must actually validate: `formData.get()` returns
> `FormDataEntryValue | null`. Narrow with a `typeof x === 'string'` check and return a
> copy-driven error, rather than casting. A Server Action is a public endpoint — the
> payload may be anything, so the server-side Zod parse in `lib/validation.ts` is the
> real gate (CLAUDE.md Authentication rule 3).

> **ANNOTATION — `redirect('/error')` loses the reason.** An error that matters to the
> user has to be *shown in the browser*, and every user-visible string in this app lives
> in `lib/copy.ts` (SPEC Block E). So: return the failure to the login form
> and render the message from `copy`, rather than bouncing to a generic error route. Do
> **not** pass Supabase's raw `error.message` to the UI — it varies by provider config
> and can distinguish "wrong password" from "no such user", which is an account-
> enumeration leak. Map it to our own copy string.

> **ANNOTATION — `revalidatePath('/', 'layout')` then `redirect()` is the right order.**
> Both must be called *outside* any `try/catch`: `redirect()` works by throwing, so a
> surrounding `catch` swallows the navigation and turns it into a silent no-op.

> **ANNOTATION — sign-up:** whether `signUp` returns a session depends on the project's
> email-confirmation setting, as the description notes. CV Insight has email
> confirmation **disabled**, so `signUp` returns a session immediately and the cookie is
> written in the action; the user lands on `/career`, because a new account's career
> base is empty and that screen is where the first import starts (SPEC Block F, US-1).
> `lib/auth/actions.ts` still handles the no-session case: if the project is ever
> switched to require confirmation, redirecting to a member route would bounce straight
> back to `/login`, so it returns `AUTH.checkEmail` instead of pretending the sign-up
> failed.

> **ANNOTATION — no service-role key.** The description explicitly notes this example
> uses the anon key. That is what every auth flow here uses: the service-role key is
> read in exactly one module (`lib/supabase/admin.ts`) and reaches exactly one caller,
> the account-deletion route — `scripts/check.mjs` R10 fails the build on any other read
> site (CLAUDE.md "Secrets").

---

## signOut Server Action

Source: https://github.com/supabase/supabase/blob/master/examples/auth/nextjs-full/components/AuthButton.tsx

Inline 'use server' function that signs out the user and redirects to /login. Invoked via a form action in a Server Component.

```typescript
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function AuthButton() {
  const supabase = await createClient()

  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims

  const signOut = async () => {
    'use server'

    const supabase = await createClient()
    await supabase.auth.signOut()
    return redirect('/login')
  }

  return claims ? (
    <div className="flex items-center gap-4">
      Hey, {claims.email}!
      <form action={signOut}>
        <button className="py-2 px-4 rounded-md no-underline bg-btn-background hover:bg-btn-background-hover">
          Logout
        </button>
      </form>
    </div>
  ) : (
    <Link
      href="/login"
      className="py-2 px-3 flex rounded-md no-underline bg-btn-background hover:bg-btn-background-hover"
    >
      Login
    </Link>
  )
}
```

> **ANNOTATION — the `signOut()` call and the `<form action={...}>` wiring are the parts
> to copy.** Sign-out must be a POST via a form action, not a `<Link>` or a GET route —
> a GET logout can be triggered by any third-party page or prefetch.

> **ANNOTATION — replace `getClaims()` with `getUser()`.** Authentication rule 2: on the server the only
> valid check is `supabase.auth.getUser()`. See
> [supabase-getuser-vs-getsession.md](supabase-getuser-vs-getsession.md) for why we do
> not adopt `getClaims()` even though current docs recommend it.

> **ANNOTATION — `Hey, {claims.email}!` is wrong here on two counts.** (a) The literal
> string must live in `lib/copy.ts`, not inline in a component (SPEC Block E). (b) Do not
> embed an address in code — the email here comes from the verified user record at
> runtime, which is fine, but the *surrounding copy* is not. Check SPEC.md Block E for
> the actual header copy before writing any of it.

> **ANNOTATION — `revalidatePath` after sign-out.** This snippet omits it. Add
> `revalidatePath('/', 'layout')` before redirecting so cached Server Component output
> rendered for the signed-in user is dropped. Otherwise a back-navigation can show a
> stale career base or application list after logout — for an app whose every row is
> owner-scoped, that is the bug that matters most.

---

## GoTrueAdminApi.signOut method signature (jwt + optional scope)

Source: https://github.com/supabase/supabase/blob/master/apps/docs/scripts/__snapshots__/build-reference-content.v2.json

Exact method signature extracted from @supabase/auth-js TypeDoc: takes a valid logged-in JWT string and an optional scope ('global' | 'local' | 'others'), returns Promise<{ data: null, error: AuthError | null }>.

```typescript
"@supabase/supabase-js.GoTrueAdminApi.signOut": {
  "name": "@supabase/supabase-js.GoTrueAdminApi.signOut",
  "params": [
    { "name": "jwt", "type": { "type": "intrinsic", "name": "string" }, "comment": { "shortText": "A valid, logged-in JWT." } },
    { "name": "scope", "type": { "type": "union", "subTypes": [{ "type": "literal", "value": "global" }, { "type": "literal", "value": "others" }, { "type": "literal", "value": "local" }] }, "isOptional": true, "comment": { "shortText": "The logout sope." } }
  ],
  "ret": { "type": { "type": "promise", "awaited": { "type": "object", "properties": [{ "name": "data", "type": { "type": "literal", "value": null } }, { "name": "error", "type": { "type": "union", "subTypes": [{ "type": "literal", "value": null }, { "type": "nameOnly", "name": "AuthError" }] } }] } } },
  "comment": { "shortText": "Removes a logged-in session." }
}
```

> **ANNOTATION — WRONG API for sign-out, note the class name.** This is
> `GoTrueAdminApi.signOut`, reached via `supabase.auth.admin.*`, which **requires the
> service-role key**. For signing a user out we call `supabase.auth.signOut()` — no
> `jwt` argument; it takes the session from the cookie.
>
> `auth.admin` itself is not forbidden here, and one call to it ships: the account
> deletion route uses `admin.auth.admin.deleteUser(userId)` for the right to erasure
> (SPEC Block D #10, US-6). What is constrained is WHERE the key may be read —
> `lib/supabase/admin.ts` and nowhere else, with `DELETE /api/account` as its only
> consumer (CLAUDE.md "Secrets", enforced by `scripts/check.mjs` R10). Do not read this
> annotation as a ban on the erasure path.
>
> The `scope` option (`'global' | 'local' | 'others'`) *does* also exist on the
> non-admin `signOut({ scope })`. Default is `'global'`, which ends the session on all
> of the user's devices — that is what the sign-out button in `/settings` uses. The
> deletion route deliberately passes `'local'` instead: by then the account is already
> gone, there is no other device session left to end, and the call is best-effort
> cookie-clearing that must not be able to report "Deletion failed" for an account that
> no longer exists.

> **ANNOTATION — errors are returned, not thrown.** Both `signInWithPassword` and
> `signOut` return `{ data, error }`; supabase-js does not throw on auth failure. An
> ignored `error` is a silent auth bug. Always destructure and handle it, and map it to
> a copy string the user actually sees.

---

## Catching and Modifying Errors in JavaScript

Source: https://github.com/supabase/supabase/blob/master/apps/docs/content/troubleshooting/edge-function-500-error-response.mdx

This example uses a `try/catch` block to handle an error, logging a custom message while still including the original error object.

```js
try {
  // induce reference error
  const a = unitialized_var // ReferenceError...
} catch (error) {
  console.error('custom error message...', error) // modifying the original error message
}
```

> **ANNOTATION:** `console.error` alone is not error handling — a terminal log is
> invisible to the user. Log for the developer *and* surface a copy string in the
> browser (`app/error.tsx`, or inline form state for a recoverable failure like a bad
> password). Never `console.error` an object that could contain a token or password.
