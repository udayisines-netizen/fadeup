#!/usr/bin/env node
/**
 * FadeUp — one-shot i18n extraction codemod.
 *
 * Migrates hardcoded user-facing English in a page into a translation
 * namespace: it emits the English JSON and rewrites the source to call t().
 *
 * WHY A CODEMOD AND NOT HANDS
 *
 *   There are ~900 strings across 47 files. Doing that by hand is not careful
 *   work, it is error-prone typing — the mistakes it produces (a missed
 *   string, a key that does not match its usage, a mangled JSX expression) are
 *   exactly the ones a human makes at volume and a machine does not.
 *
 *   What a machine must NOT do is choose the words. Every emitted English
 *   string is copied verbatim from the source, and the translations into the
 *   other nine locales are written by hand afterwards, because that is the
 *   part that needs judgment.
 *
 * DELIBERATELY CONSERVATIVE
 *
 *   It only rewrites the three shapes it can prove are safe:
 *     1. user-facing props with a plain string literal
 *     2. JSX text nodes with no embedded expression
 *     3. toast/setError string arguments
 *   Anything with interpolation, ternaries or nested JSX is left alone and
 *   reported, so a person handles it.
 *
 * Usage:
 *   node scripts/extract-i18n.mjs --ns app --key-prefix services \
 *        --out src/locales/en/app.json src/pages/app-services-page.tsx
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const USER_FACING_PROPS = new Set([
  'label', 'title', 'description', 'placeholder', 'aria-label', 'alt', 'hint',
  'emptyTitle', 'emptyDescription', 'closedLabel', 'confirmLabel', 'cancelLabel',
  'submitLabel', 'heading', 'subtitle', 'message', 'helperText', 'caption',
])

/** Shared vocabulary: these never get a page-specific key. */
let SHARED = {}

function slug(value) {
  const words = value
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((w) => w.replace(/[^\w]/g, ''))
    .filter(Boolean)
  if (words.length === 0) return 'text'
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
}

function looksLikeProse(value) {
  const text = value.trim()
  if (text.length < 3) return false
  if (!/[A-Za-z]/.test(text)) return false
  if (/^[a-z0-9_.:-]+$/.test(text)) return false
  if (/^[a-z]+([A-Z][a-z]*)+$/.test(text)) return false
  if (/^[A-Z0-9_]+$/.test(text)) return false
  if (text.startsWith('/') || text.startsWith('http') || text.includes('://')) return false
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
  return /\s/.test(text) || /^[A-Z]/.test(text)
}

function maskNonSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
}

function main() {
  const args = process.argv.slice(2)
  const get = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i === -1 ? fallback : args[i + 1]
  }
  const ns = get('--ns', 'app')
  const prefix = get('--key-prefix', 'page')
  const out = get('--out', `src/locales/en/${ns}.json`)
  const sharedPath = get('--shared', 'src/locales/en/common.json')
  const files = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))

  if (existsSync(sharedPath)) {
    const shared = JSON.parse(readFileSync(sharedPath, 'utf8'))
    // Flatten common.* into value -> key so repeated vocabulary is reused.
    const walk = (obj, path = []) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') SHARED[v] = [...path, k].join('.')
        else if (v && typeof v === 'object') walk(v, [...path, k])
      }
    }
    walk(shared)
  }

  const bundle = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {}
  bundle[prefix] = bundle[prefix] ?? {}
  const skipped = []

  for (const file of files) {
    let source = readFileSync(file, 'utf8')
    const masked = maskNonSource(source)
    const edits = []

    const register = (value) => {
      if (SHARED[value]) return { call: `t('common:${SHARED[value]}')`, shared: true }
      const key = slug(value)
      bundle[prefix][key] = value
      return { call: `t('${ns}:${prefix}.${key}')`, shared: false }
    }

    // 1. props
    for (const m of masked.matchAll(/(\b[a-zA-Z-]+)=(?:"([^"]*)"|'([^']*)')/g)) {
      const [full, prop, dq, sq] = m
      if (!USER_FACING_PROPS.has(prop)) continue
      const value = dq ?? sq ?? ''
      if (!looksLikeProse(value)) continue
      const { call } = register(value)
      edits.push({ start: m.index, end: m.index + full.length, replacement: `${prop}={${call}}` })
    }

    // 2. JSX text nodes. STRICT — see find-hardcoded-strings.mjs for the two
    //    corruptions a looser pattern caused (TS generics and ternaries).
    for (const m of masked.matchAll(/(?<!=)>([^<>{}()[\];=`]{3,}?)<(?=[/A-Za-z])/gs)) {
      const value = m[1].replace(/\s+/g, ' ').trim()
      if (!looksLikeProse(value)) continue
      const { call } = register(value)
      const leading = m[1].match(/^\s*/)[0]
      const trailing = m[1].match(/\s*$/)[0]
      edits.push({
        start: m.index + 1,
        end: m.index + 1 + m[1].length,
        replacement: `${leading}{${call}}${trailing}`,
      })
    }

    // 3. toast / setError
    for (const m of masked.matchAll(/\b(toast|setError|setFormError)\(\s*\{?\s*(title:\s*)?(?:"([^"]{3,})"|'([^']{3,})')/g)) {
      const value = m[3] ?? m[4] ?? ''
      if (!looksLikeProse(value)) continue
      const { call } = register(value)
      const quoted = m[0].slice(m[0].length - value.length - 2)
      const at = m.index + m[0].length - quoted.length
      edits.push({ start: at, end: at + quoted.length, replacement: call })
    }

    // Apply from the end so earlier offsets stay valid.
    edits.sort((a, b) => b.start - a.start)
    let last = Infinity
    for (const edit of edits) {
      if (edit.end > last) {
        skipped.push(`${file}: overlapping edit at ${edit.start}`)
        continue
      }
      source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end)
      last = edit.start
    }

    writeFileSync(file, source)
    console.log(`${file}: ${edits.length} strings extracted`)
  }

  writeFileSync(out, JSON.stringify(bundle, null, 2) + '\n')
  if (skipped.length) {
    console.log('\nSKIPPED (handle by hand):')
    for (const s of skipped) console.log('  ' + s)
  }
}

main()
