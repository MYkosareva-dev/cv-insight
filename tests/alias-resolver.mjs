import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Module-resolution hook for `node --test`: maps the `@/*` path alias to
 * `src/*` and supplies the file extension TypeScript source omits.
 *
 * tsconfig maps `@/*` → `./src/*` and Next honours it, but plain Node resolves
 * neither the alias nor an extensionless specifier — so a pure module importing
 * `@/lib/copy` was untestable. The runner learns the convention rather than app
 * code adopting relative, extension-bearing imports to suit the runner.
 *
 * Test-only: nothing under src/ loads this.
 */
const SRC = pathToFileURL(path.join(process.cwd(), 'src') + path.sep).href;
const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js'];

/** Add the extension TS omits, or fall through to Node's own resolution. */
function withExtension(url) {
  const filePath = fileURLToPath(url);
  if (existsSync(filePath)) return url;
  for (const ext of EXTENSIONS) {
    if (existsSync(filePath + ext)) return pathToFileURL(filePath + ext).href;
  }
  for (const ext of EXTENSIONS) {
    const indexPath = path.join(filePath, `index${ext}`);
    if (existsSync(indexPath)) return pathToFileURL(indexPath).href;
  }
  return url;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const aliased = new URL(specifier.slice(2), SRC).href;
    return nextResolve(withExtension(aliased), context);
  }
  return nextResolve(specifier, context);
}
