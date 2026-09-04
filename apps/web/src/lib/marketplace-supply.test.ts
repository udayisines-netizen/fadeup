import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MARKETPLACE_SUPPLY_TYPES } from '@/lib/queries/marketplace'

/**
 * The customer supply model, enforced at the frontend's half of it.
 *
 * The MAPPING from `organizations.business_type` is no longer here — the RPC
 * derives it, and `db/tests/verify_marketplace_supply_type.sql` proves every
 * enum value maps correctly and that an unclassified one yields NULL rather
 * than a guess. What this file guards is the two things the frontend still
 * decides: which rows are supply, and that no client-side copy of the internal
 * enum ever creeps back in.
 */

describe('the public vocabulary', () => {
  it('has exactly two values', () => {
    expect([...MARKETPLACE_SUPPLY_TYPES]).toEqual(['independent', 'barbershop'])
  })
})

/**
 * The architectural guarantee, asserted rather than trusted.
 *
 * The whole point of deriving the label in the RPC is that the customer product
 * never learns FadeUp's internal organization modelling. That is easy to undo by
 * accident — one `import type { BusinessType }` to "be helpful" and the coupling
 * is back, along with a second copy of a product rule free to drift from the
 * database's.
 */
describe('the customer product does not know the internal organization model', () => {
  /* Scan the whole frontend source tree: the rule outlives any one namespace. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return /\.tsx?$/.test(entry.name) ? [full] : []
    })
  }

  it('never mentions business_type, BusinessType or any internal enum value', () => {
    const forbidden = [
      'business_type',
      'BusinessType',
      'solo_professional',
      'hair_salon',
      'mixed_salon',
      'multi_location',
    ]

    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      // This spec necessarily names them in order to ban them.
      if (file.endsWith('marketplace-supply.test.ts')) continue
      // Platform/ops surfaces legitimately administer the internal model.
      if (file.includes('/pages/platform-') || file.includes('/components/platform/') || file.includes('/components/acquisition/')) continue
      if (file.includes('/lib/')) continue
      /*
       * The PRO workspace (not the customer product) gates its Team nav on
       * `business_type !== 'solo_professional'` — mandated by P1b §7. The
       * value is never DISPLAYED; only `marketplace_supply_type` ever reaches
       * a customer.
       */
      if (file.includes('/features/pro/') || file.includes('/app/shells/ProShell')) continue

      /*
        COMMENTS ARE EXEMPT, AND DELIBERATELY SO. Coupling is a thing code does.
        Prose explaining WHY the internal enum is not used here is exactly what
        should survive, and banning the words from it would delete the reasoning
        that stops someone reintroducing the mapping.
      */
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ')

      for (const term of forbidden) {
        if (code.includes(term)) offenders.push(`${file.split('/src/')[1]} → "${term}"`)
      }
    }

    expect(offenders, 'the internal enum must not reach the customer product').toEqual([])
  })
})
