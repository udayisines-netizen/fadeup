/**
 * Types for the audit script, which is plain ESM so it can also be run
 * directly from the command line (`node scripts/find-hardcoded-strings.mjs`).
 * Keeping it .mjs is deliberate — a build step for a lint tool would make it
 * something people stop running.
 */
export interface HardcodedFinding {
  file: string
  line: number
  kind: 'prop' | 'text' | 'toast'
  prop?: string
  value: string
}

export function findHardcoded(file: string): HardcodedFinding[]
