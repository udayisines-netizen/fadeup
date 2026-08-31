import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Everything in `src/` is shipped to a browser. Nobody can be trusted to
 * remember that under deadline, so this asserts it structurally instead of by
 * review: exactly one Supabase client is ever constructed in this tree, and it
 * is constructed with the anon key.
 *
 * The reason is the whole authorization model. The browser client's only
 * identity is the end user's session JWT, which is what makes RLS the thing
 * that decides access — for queries, for RPCs, and for Realtime's Postgres
 * Changes, which only delivers rows the subscriber's own policies would let
 * them SELECT. A `service_role` key here would bypass every one of those
 * policies at once and hand any visitor with devtools the whole database.
 */

/** Vitest runs with `apps/web` as its root (see vite.config.ts). */
const SRC = join(process.cwd(), 'src')

/** Everything Vite would bundle: `.ts`/`.tsx` under src, minus the tests. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe('browser bundle credentials', () => {
  const files = sourceFiles(SRC)

  it('finds source files to scan', () => {
    // Guards the guard: a broken path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(50)
  })

  it('constructs a Supabase client in exactly one place', () => {
    const constructors = files.filter((file) => /\bcreateClient\s*\(/.test(readFileSync(file, 'utf8')))

    expect(constructors.map((file) => relative(SRC, file))).toEqual(['lib/supabase.ts'])
  })

  it('constructs it with the anon key and no secret', () => {
    const source = readFileSync(join(SRC, 'lib/supabase.ts'), 'utf8')

    expect(source).toContain('VITE_SUPABASE_ANON_KEY')
    expect(source).not.toMatch(/SERVICE_ROLE/i)
  })

  it('never reads a privileged key from the environment', () => {
    // Vite only exposes `VITE_`-prefixed values to the client, and the env
    // schema is the single place this app reads config from. Neither may name
    // a service-role or otherwise privileged credential.
    const offenders = files.filter((file) =>
      /(SERVICE_ROLE|SERVICE_KEY|SECRET_KEY|DB_PASSWORD)\b/i.test(
        readFileSync(file, 'utf8')
          // Comments legitimately discuss service_role when explaining why a
          // policy exists; it is a reference to it in CODE that would be a leak.
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|\s)\/\/.*$/gm, ''),
      ),
    )

    expect(offenders.map((file) => relative(SRC, file))).toEqual([])
  })
})
