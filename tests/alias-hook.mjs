import { register } from 'node:module';

/**
 * Registration entry for the `@/*` alias resolver. Passed to Node as
 * `--import ./tests/alias-hook.mjs`; the hook itself lives in
 * alias-resolver.mjs because `register()` loads it in a separate thread.
 */
register('./alias-resolver.mjs', import.meta.url);
