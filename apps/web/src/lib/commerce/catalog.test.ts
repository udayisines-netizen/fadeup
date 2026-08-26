import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES,
  PLANS,
  PLAN_IDS,
  type CapabilityId,
  type CapabilityStatus,
  type CommercialFamily,
  type PlanId,
} from '@/lib/commerce/plans'
import { planPriceMinor } from '@/lib/commerce/pricing'

/**
 * THE SYNCHRONISATION MECHANISM.
 *
 * FadeUp deliberately keeps its commercial catalog in two places, and that is
 * a decision worth defending rather than an accident:
 *
 *   the DATABASE needs it, because a trigger cannot ask a TypeScript module
 *   whether this organization may open an eleventh salon;
 *
 *   the APPLICATION needs it, because a marketing page rendered to an
 *   anonymous visitor must not depend on a round trip, and because the pricing
 *   experience has to work before anyone has an account at all.
 *
 * Two copies of a price list is exactly how a product ends up quoting one
 * number on one screen and another elsewhere — which FadeUp had actually done,
 * at /pricing versus /for-business, before R2.
 *
 * So the copies are not trusted to agree. This test PARSES the migration that
 * seeds the database and compares it to the compiled catalog, key by key,
 * price by price, capability by capability. If anyone edits one side and not
 * the other, this fails — and that is the only reason it is safe to have two
 * sides at all.
 *
 * It reads the migration rather than the MASTER file on purpose: MASTER is
 * generated FROM the migrations, so the migration is the thing a person edits
 * and therefore the thing that can drift.
 */

// Resolved from the Vitest working directory (apps/web) rather than from
// import.meta.url: under the jsdom environment import.meta.url is not a file:
// URL, so fileURLToPath rejects it and the whole suite fails to load. The
// existence check below turns a wrong path into a named failure rather than
// into a suite that silently reports nothing.
const MIGRATION_PATH = resolve(
  process.cwd(),
  '../../db/migrations/20260826110000_commercial_plan_catalog.sql',
)

const MIGRATION = existsSync(MIGRATION_PATH) ? readFileSync(MIGRATION_PATH, 'utf8') : ''

interface SqlPlan {
  planKey: string
  family: string
  displayName: string
  priceMinor: number
  maxEstablishments: number
  maxOperationalProfessionals: number | null
  recommended: boolean
  tier: number
}

/**
 * The seeded plan rows. The shape is fixed by the migration's own VALUES list:
 *
 *   ('salon_pro', 'salon', 'Pro', 4900, 'EUR', 1, null, true, 2)
 *
 * A row that stops matching this pattern is not silently skipped — the count
 * assertion below catches it, because exactly eight plans must be found.
 */
function parsePlans(): SqlPlan[] {
  const block = MIGRATION.slice(
    MIGRATION.indexOf('insert into public.commercial_plans'),
    MIGRATION.indexOf('on conflict (plan_key) do update'),
  )
  const row =
    /\(\s*'([a-z_]+)',\s*'([a-z_]+)',\s*'([^']+)',\s*(\d+),\s*'EUR',\s*(\d+),\s*(\d+|null),\s*(true|false),\s*(\d+)\s*\)/g

  const plans: SqlPlan[] = []
  for (const m of block.matchAll(row)) {
    plans.push({
      planKey: m[1]!,
      family: m[2]!,
      displayName: m[3]!,
      priceMinor: Number(m[4]),
      maxEstablishments: Number(m[5]),
      maxOperationalProfessionals: m[6] === 'null' ? null : Number(m[6]),
      recommended: m[7] === 'true',
      tier: Number(m[8]),
    })
  }
  return plans
}

interface SqlCapability {
  key: string
  group: string
  status: string
}

function parseCapabilities(): SqlCapability[] {
  const block = MIGRATION.slice(
    MIGRATION.indexOf('insert into public.commercial_capabilities'),
    MIGRATION.indexOf('on conflict (capability_key) do update'),
  )
  const row = /\(\s*'([a-zA-Z]+)',\s*'(foundation|floor|retention|scale)',\s*'(live|planned)',/g

  const capabilities: SqlCapability[] = []
  for (const m of block.matchAll(row)) {
    capabilities.push({ key: m[1]!, group: m[2]!, status: m[3]! })
  }
  return capabilities
}

/**
 * The plan -> capability matrix, expanded from the migration's CTE.
 *
 * The migration builds it out of named sets (`foundation`, `floor_set`, …) so
 * the SQL stays readable, which means this parser has to expand them the same
 * way the database does. Two steps: collect every `name(capability_key) as (
 * values (...) )` block, then walk the `select 'plan', capability_key from
 * <source>` lines, where the source is either a named set or an inline VALUES
 * list.
 */
function parseMatrix(): Map<string, Set<string>> {
  const block = MIGRATION.slice(
    MIGRATION.indexOf('with foundation(capability_key) as ('),
    MIGRATION.indexOf('insert into public.plan_capabilities'),
  )

  const sets = new Map<string, string[]>()
  for (const m of block.matchAll(/(\w+)\(capability_key\) as \(([\s\S]*?)\n\)/g)) {
    const body = m[2]!
    // Only literal VALUES sets, so the `matrix` CTE itself — which is built
    // from selects — cannot be mistaken for one.
    if (!body.includes('values')) continue
    sets.set(m[1]!, [...body.matchAll(/'([a-zA-Z]+)'/g)].map((v) => v[1]!))
  }

  const matrix = new Map<string, Set<string>>()
  const add = (plan: string, keys: string[]) => {
    const current = matrix.get(plan) ?? new Set<string>()
    for (const k of keys) current.add(k)
    matrix.set(plan, current)
  }

  // `select 'free', capability_key from free_set`, and every `union all` sibling.
  for (const m of block.matchAll(/select '([a-z_]+)', capability_key from (\w+)/g)) {
    const source = sets.get(m[2]!)
    if (source) add(m[1]!, source)
  }

  // Inline VALUES:
  //   union all select 'solo', capability_key from (values ('walkIns'), ('liveQueue')) as s(capability_key)
  // Non-greedy up to the `) as s` alias, because the VALUES list itself
  // contains parentheses: `(values ('walkIns'), ('liveQueue')) as s(...)`.
  for (const m of block.matchAll(/select '([a-z_]+)', capability_key from \(values ([\s\S]*?)\) as s/g)) {
    add(m[1]!, [...m[2]!.matchAll(/'([a-zA-Z]+)'/g)].map((v) => v[1]!))
  }

  return matrix
}

const SQL_PLANS = parsePlans()
const SQL_CAPABILITIES = parseCapabilities()
const SQL_MATRIX = parseMatrix()

describe('the migration parses at all', () => {
  // If the parser silently matched nothing, every comparison below would pass
  // vacuously — the exact failure mode a synchronisation test cannot afford.
  it('found the migration on disk', () => {
    expect(existsSync(MIGRATION_PATH), `missing: ${MIGRATION_PATH}`).toBe(true)
    expect(MIGRATION.length).toBeGreaterThan(1000)
  })

  it('found all eight seeded plans', () => {
    expect(SQL_PLANS).toHaveLength(8)
  })

  it('found all thirty seeded capabilities', () => {
    expect(SQL_CAPABILITIES).toHaveLength(30)
  })

  it('expanded a matrix row for every plan', () => {
    expect([...SQL_MATRIX.keys()].sort()).toEqual([...PLAN_IDS].sort())
    for (const [plan, caps] of SQL_MATRIX) {
      expect(caps.size, `${plan} expanded to an empty capability set`).toBeGreaterThan(0)
    }
  })
})

describe('the database and the application agree about the plans', () => {
  it('has exactly the same plan keys on both sides', () => {
    expect(SQL_PLANS.map((p) => p.planKey).sort()).toEqual([...PLAN_IDS].sort())
  })

  for (const sql of SQL_PLANS) {
    const planId = sql.planKey as PlanId

    it(`agrees about ${sql.planKey}`, () => {
      const ts = PLANS[planId]
      expect(ts, `${sql.planKey} exists in the migration but not in plans.ts`).toBeDefined()

      expect(ts.family).toBe(sql.family as CommercialFamily)
      expect(ts.maxEstablishments).toBe(sql.maxEstablishments)
      expect(ts.maxOperationalProfessionals).toBe(sql.maxOperationalProfessionals)
      expect(ts.recommended).toBe(sql.recommended)
      expect(ts.tier).toBe(sql.tier)

      // The France column IS the database's price. Every other region is a
      // separate commercial decision the database does not model.
      expect(planPriceMinor(planId, 'eu')).toBe(sql.priceMinor)
    })
  }

  it('keeps the two "Pro" plans apart on both sides', () => {
    const pros = SQL_PLANS.filter((p) => p.displayName === 'Pro')
      .map((p) => p.planKey)
      .sort()
    expect(pros).toEqual(['multi_pro', 'salon_pro'])
    expect(planPriceMinor('salon_pro', 'eu')).not.toBe(planPriceMinor('multi_pro', 'eu'))
  })
})

describe('the database and the application agree about the capabilities', () => {
  it('has exactly the same capability keys on both sides', () => {
    expect(SQL_CAPABILITIES.map((c) => c.key).sort()).toEqual(Object.keys(CAPABILITIES).sort())
  })

  for (const sql of SQL_CAPABILITIES) {
    it(`agrees about ${sql.key}`, () => {
      const ts = CAPABILITIES[sql.key as CapabilityId]
      expect(ts, `${sql.key} exists in the migration but not in plans.ts`).toBeDefined()
      expect(ts.group).toBe(sql.group)
      expect(ts.status).toBe(sql.status as CapabilityStatus)
    })
  }
})

describe('the database and the application agree about the matrix', () => {
  for (const planId of PLAN_IDS) {
    it(`packages the same capabilities for ${planId}`, () => {
      const fromSql = [...(SQL_MATRIX.get(planId) ?? new Set<string>())].sort()
      const fromTs = [...PLANS[planId].capabilities].sort()
      expect(fromSql).toEqual(fromTs)
    })
  }
})

describe('what the two catalogs are FOR', () => {
  it('never lets the application claim a capability the database would refuse', () => {
    // The asymmetry that matters. The compiled catalog is presentation; the
    // database decides. If the application ever packaged something the database
    // does not, a plan would advertise access it cannot grant.
    for (const planId of PLAN_IDS) {
      const database = SQL_MATRIX.get(planId) ?? new Set<string>()
      for (const capability of PLANS[planId].capabilities) {
        expect(database.has(capability), `${planId} claims ${capability} in the UI only`).toBe(true)
      }
    }
  })
})
