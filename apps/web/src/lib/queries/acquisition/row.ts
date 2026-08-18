/**
 * Typed accessors for PostgREST rows.
 *
 * Supabase's untyped client returns rows whose fields are `any`. Casting a
 * whole row to a hand-written interface asserts a shape the compiler never
 * checked and the server never promised — if a column is renamed in a
 * migration, that cast keeps compiling and the UI silently renders
 * `undefined`.
 *
 * These helpers narrow one field at a time, at runtime, with an explicit
 * fallback. The cost is a little verbosity at each call site; the benefit
 * is that a schema drift shows up as a visible default rather than a
 * crash or a blank cell.
 */

export type Row = Record<string, unknown>

/** Casts a PostgREST result to a list of opaque rows, to be read with the accessors below. */
export function asRows(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : []
}

/** Casts a single PostgREST result row, or null when the query returned nothing. */
export function asRow(data: unknown): Row | null {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Row) : null
}

export function str(row: Row, key: string, fallback = ''): string {
  const value = row[key]
  return typeof value === 'string' ? value : fallback
}

export function strOrNull(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

export function num(row: Row, key: string, fallback = 0): number {
  const value = row[key]
  if (typeof value === 'number') return value
  // PostgREST returns numeric/bigint columns as strings to avoid precision
  // loss, so a string that parses cleanly is a legitimate number here.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function numOrNull(row: Row, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function bool(row: Row, key: string, fallback = false): boolean {
  const value = row[key]
  return typeof value === 'boolean' ? value : fallback
}

export function boolOrNull(row: Row, key: string): boolean | null {
  const value = row[key]
  return typeof value === 'boolean' ? value : null
}

export function strArray(row: Row, key: string): string[] {
  const value = row[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** A jsonb object column. Returns an empty object rather than null, so callers never guard. */
export function jsonObject(row: Row, key: string): Record<string, unknown> {
  const value = row[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** A jsonb object whose values are all numbers (metrics, coverage maps). Non-numeric entries are dropped. */
export function numberMap(row: Row, key: string): Record<string, number> {
  const source = jsonObject(row, key)
  const result: Record<string, number> = {}
  for (const [entryKey, entryValue] of Object.entries(source)) {
    if (typeof entryValue === 'number') result[entryKey] = entryValue
  }
  return result
}

/** A jsonb array column. */
export function jsonArray(row: Row, key: string): unknown[] {
  const value = row[key]
  return Array.isArray(value) ? value : []
}

/**
 * A value constrained to a known union. Falls back rather than widening,
 * so an unexpected enum value from a newer migration cannot leak into
 * rendering logic that switches on it.
 */
export function enumValue<T extends string>(row: Row, key: string, allowed: readonly T[], fallback: T): T {
  const value = row[key]
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * An embedded PostgREST relation. Depending on the relationship cardinality
 * PostgREST returns either an object or a single-element array, so both
 * shapes are normalised here.
 */
export function embedded(row: Row, key: string): Row | null {
  const value = row[key]
  if (Array.isArray(value)) {
    const first = value[0]
    return first && typeof first === 'object' ? (first as Row) : null
  }
  return value && typeof value === 'object' ? (value as Row) : null
}

/** A field on an embedded relation, or null when the relation is absent. */
export function embeddedStr(row: Row, relation: string, key: string): string | null {
  const related = embedded(row, relation)
  return related ? strOrNull(related, key) : null
}
