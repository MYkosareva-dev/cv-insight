Source: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/getting-started/migrating-to-new-api-keys.mdx
Also: https://github.com/supabase/supabase/blob/master/apps/www/_blog/2025-07-14-jwt-signing-keys.mdx
Also: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/self-hosting/self-hosted-auth-keys.mdx

# API keys: publishable and secret (the names that replaced anon and service_role)

Fetched via Context7 from `/supabase/supabase`.
Content below is pasted as returned. Annotations are ours.

> **ANNOTATION (applies to this whole file):** this file exists because the Supabase
> dashboard now shows two key panels at once, under names that do not match the
> variables in `.env.example` — an operator looking for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
> finds a panel offering a "publishable" key and a "secret" one, and has to decide which
> is which while standing next to the one key that must never be in this repo. That is
> the whole risk this file addresses. CLAUDE.md "Secrets" is unchanged and
> unconditional: **client-side code uses only the low-privilege key**, whichever of its
> two names the dashboard shows; the service-role key is read in exactly one module
> (`lib/supabase/admin.ts`) and never reaches the browser.

---

## Which key replaces which

> Source: `migrating-to-new-api-keys.mdx`

When migrating, the legacy `anon` key should be replaced with a Publishable key, which
is used by browsers, mobile/desktop apps, CLIs, and public sources. The `service_role`
key should be replaced with a Secret key, intended for servers, Edge Functions,
workers, and other backend code.

```ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://your-project.supabase.co',
  'sb_publishable_...' // was the anon key
)
```

> **ANNOTATION:** this is the key `NEXT_PUBLIC_SUPABASE_ANON_KEY` holds. The variable
> keeps its name for continuity with SPEC.md Block H and `.env.example`; the *role* is
> identical, which is why nothing in `lib/supabase/` changed when the panel did. The
> corresponding admin snippet in the same upstream guide — a client built with the
> secret key — is **deliberately not quoted here.** It is a copy-paste-ready line
> whose only purpose is to bypass row-level security. `scripts/check.mjs` would NOT
> catch it here — R4 exempts `docs/` so a reference file can quote a forbidden pattern,
> and R10 only scans `src/` and `tests/` — so nothing but this decision keeps it out.
> The one thing worth knowing from it is recorded as prose instead: secret keys bypass
> RLS.

## Key format

> Source: `self-hosted-auth-keys.mdx`

```text
sb_publishable_<22-char-random>_<8-char-checksum>
sb_secret_<22-char-random>_<8-char-checksum>
```

> **ANNOTATION — no code depends on this; it is recorded because a future guard would.**
> This project performs NO boot-time key-format check: `src/lib/supabase/` holds exactly
> `server.ts`, `cookie-options.ts` and `admin.ts` (SPEC Block A), and nothing inspects a
> key's prefix at startup. What the format buys, should one ever be proposed, is bounded:
> the two NEW prefixes are distinguishable by string comparison, so a secret key pasted
> into a `NEXT_PUBLIC_*` variable could be refused before the app serves a byte — but the
> **legacy** pair is not distinguishable that way, since `anon` and `service_role` are
> both JWTs differing only in a `role` claim inside the base64 payload. A guard would
> therefore catch the new-format mistake and not the old-format one, and would have to
> say so in place rather than implying wider cover than it has. Adding one is a SPEC
> Block A change first, not a drive-by.

## Why the change

> Source: `2025-07-14-jwt-signing-keys.mdx`

`anon` and `service_role` are your project's legacy API keys. They identify what
*application* (as opposed to which *user*) is accessing your data. Sadly they're JWTs
that expire 10 years after you create your project. And as you're probably guessing,
rotating and then revoking the legacy JWT secret will reject them. […] You should
switch to publishable/secret keys even if you're not taking advantage of the new JWT
signing keys feature.

> **ANNOTATION:** relevant to this repo only as the reason the dashboard has two panels
> at once — the confusion this file exists to settle. Nothing here asks for a code
> change: neither key type changes how `@supabase/ssr` is called, and `.env.example`
> names the variables rather than any dashboard label, so it stays correct under either
> naming.
