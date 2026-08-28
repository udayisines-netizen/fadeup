#!/usr/bin/env node
/**
 * Deep-merges translation additions into every locale file at once.
 *
 * Adding a key by hand means opening ten files and getting ten JSON documents
 * byte-identical in shape. `locale-completeness.test.ts` catches the one you
 * forgot, but only after the fact, and the fix is another ten edits. This
 * takes one patch object keyed by namespace → locale and writes all of them,
 * preserving key order and the repository's two-space formatting.
 *
 * Usage: node scripts/patch-locales.mjs <patch.json>
 *
 * Patch shape:
 *   { "<namespace>": { "<locale>": { ...nested keys to merge... } } }
 *
 * Existing keys are OVERWRITTEN by the patch, so re-running a patch is safe
 * and correcting a translation is a one-line change to the patch file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')

function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {}
      merge(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
}

const patchPath = process.argv[2]
if (!patchPath) {
  console.error('usage: patch-locales.mjs <patch.json>')
  process.exit(1)
}

const patch = JSON.parse(readFileSync(patchPath, 'utf8'))
let written = 0

for (const [namespace, byLocale] of Object.entries(patch)) {
  for (const [locale, additions] of Object.entries(byLocale)) {
    const file = join(LOCALES, locale, `${namespace}.json`)
    const current = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, `${JSON.stringify(merge(current, additions), null, 2)}\n`, 'utf8')
    written += 1
  }
}

console.log(`patched ${written} locale files`)
