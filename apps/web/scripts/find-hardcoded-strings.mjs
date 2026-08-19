#!/usr/bin/env node
/**
 * FadeUp — hardcoded user-facing English detector.
 *
 * WHY THIS EXISTS
 *
 *   "Missing keys = 0" is easy to satisfy and easy to misread: it only means
 *   every locale has whatever keys English defines. It says nothing about the
 *   strings that never entered the translation system at all — and that was
 *   exactly the state of the Professional workspace and Platform, where every
 *   label was a literal in TSX.
 *
 *   So this looks at the OTHER side: source files, not locale files. It finds
 *   English that a user can read and that i18next has never seen.
 *
 * WHAT COUNTS AS USER-FACING
 *
 *   * JSX text nodes            <p>Save changes</p>
 *   * user-facing JSX props     label= title= description= placeholder=
 *                               aria-label= alt= hint= emptyTitle= ...
 *   * toast/alert payloads      toast({ title: 'Saved' })
 *
 * WHAT DOES NOT
 *
 *   className, keys, ids, test ids, routes, query keys, enum values, imports,
 *   comments, console output, and anything already wrapped in t(). Those are
 *   either invisible to users or deliberately untranslated.
 *
 * Usage:
 *   node scripts/find-hardcoded-strings.mjs 'src/pages/app-*.tsx'
 *   node scripts/find-hardcoded-strings.mjs --json 'src/pages/platform-*.tsx'
 */

import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

/** Props whose value a user reads. Anything not listed is assumed structural. */
const USER_FACING_PROPS = new Set([
  'label',
  'title',
  'description',
  'placeholder',
  'aria-label',
  'alt',
  'hint',
  'emptyTitle',
  'emptyDescription',
  'closedLabel',
  'confirmLabel',
  'cancelLabel',
  'submitLabel',
  'heading',
  'subtitle',
  'message',
  'error',
  'helperText',
  'tooltip',
  'caption',
])

/**
 * Looks like a sentence a person would read, rather than an identifier.
 *
 * The heuristics matter more than they look: `bg-paper-50`, `organization_id`
 * and `appointments` are all "strings with letters", and flagging them would
 * make the tool useless noise.
 */
function looksLikeProse(value) {
  const text = value.trim()
  if (text.length < 3) return false
  // Must contain a letter and start with a capital or be multi-word.
  if (!/[A-Za-z]/.test(text)) return false
  // Identifiers / tokens / classes / paths / urls.
  if (/^[a-z0-9_.:-]+$/.test(text)) return false
  if (/^[a-z]+([A-Z][a-z]*)+$/.test(text)) return false // camelCase
  if (/^[A-Z0-9_]+$/.test(text)) return false // CONSTANT_CASE
  if (text.startsWith('/') || text.startsWith('http')) return false
  if (text.includes('://')) return false
  // Tailwind-ish: many tokens separated by spaces, all lowercase with dashes.
  if (/^[a-z0-9:/[\]().-]+(\s+[a-z0-9:/[\]().-]+)+$/.test(text)) return false
  // A TypeScript type-annotation fragment, not a sentence. `barberById: Map`
  // sits between the `>` of one generic and the `<` of the next, and reads as
  // prose to any pattern naive enough to look only for words.
  if (/^\w+\??\s*:\s*[\w.]*$/.test(text)) return false
  if (/^[,:;.]/.test(text)) return false
  // The brand name is never translated. The web-interface guidelines ask for
  // translate="no" on brand names precisely so machine translation leaves
  // them alone; flagging it here would be asking to translate "FadeUp".
  if (/^FadeUp$/i.test(text)) return false
  if (text.includes('=>') || text.includes('...')) return false
  // Needs either a space (a phrase) or a leading capital (a word like "Save").
  return /\s/.test(text) || /^[A-Z]/.test(text)
}

function stripNonSource(source) {
  // Remove comments and import lines so their prose is not reported.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*import\s|^\s*export\s+\*|^\s*from\s/.test(line) ? '' : line))
    .join('\n')
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

export function findHardcoded(file) {
  const raw = readFileSync(file, 'utf8')
  const source = stripNonSource(raw)
  const findings = []

  // 1. User-facing props with a literal string value.
  const propPattern = /(\b[a-zA-Z-]+)=(?:"([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(propPattern)) {
    const [, prop, dq, sq] = match
    if (!USER_FACING_PROPS.has(prop)) continue
    const value = dq ?? sq ?? ''
    if (!looksLikeProse(value)) continue
    findings.push({ file, line: lineOf(source, match.index), kind: 'prop', prop, value })
  }

  // 2. JSX text nodes.
  //
  //    STRICT, because TSX is not HTML. Two shapes bit an earlier, looser
  //    version of this and both are silent corruptions rather than obvious
  //    breakage:
  //
  //      useState<Foo | null>(null)   generics are angle brackets too, so a
  //                                   naive >...< match spans real code
  //      ) : isError ? (              a ternary between two JSX blocks looks
  //                                   exactly like a text node
  //
  //    So the opening `>` must not be part of `=>`, the closing `<` must
  //    begin a tag (`</` or `<Letter`), and the content must contain none of
  //    ()[];={}` — punctuation that appears constantly in code and almost
  //    never in a UI label.
  const textPattern = /(?<!=)>([^<>{}()[\];=`]{3,}?)<(?=[/A-Za-z])/gs
  for (const match of source.matchAll(textPattern)) {
    const value = match[1].replace(/\s+/g, ' ').trim()
    if (!looksLikeProse(value)) continue
    if (/^[{}\s]*$/.test(value)) continue
    findings.push({ file, line: lineOf(source, match.index), kind: 'text', value })
  }

  // 3. toast(...) / Alert payload titles.
  const toastPattern = /\b(?:toast|setError|setFormError)\(\s*\{?\s*(?:title:\s*)?(?:"([^"]{3,})"|'([^']{3,})')/g
  for (const match of source.matchAll(toastPattern)) {
    const value = match[1] ?? match[2] ?? ''
    if (!looksLikeProse(value)) continue
    findings.push({ file, line: lineOf(source, match.index), kind: 'toast', value })
  }

  return findings
}

function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const patterns = args.filter((a) => !a.startsWith('--'))
  if (patterns.length === 0) {
    console.error('usage: find-hardcoded-strings.mjs [--json] <glob>...')
    process.exit(2)
  }

  const files = patterns.flatMap((pattern) => globSync(pattern)).filter((f) => !f.includes('.test.'))
  const all = files.flatMap((file) => findHardcoded(file))

  if (asJson) {
    console.log(JSON.stringify(all, null, 2))
    return
  }

  const byFile = new Map()
  for (const finding of all) {
    byFile.set(finding.file, (byFile.get(finding.file) ?? 0) + 1)
  }
  for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(4)}  ${file}`)
  }
  console.log(`\nTOTAL: ${all.length} hardcoded user-facing strings in ${byFile.size} files`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
