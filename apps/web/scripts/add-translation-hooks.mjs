#!/usr/bin/env node
/**
 * Adds `const { t } = useTranslation()` to every component that needs it.
 *
 * The extraction codemod rewrites strings into `t(...)` calls but cannot know
 * which component each one landed in — these pages hold a dozen components
 * each, and `t` has to be a hook call inside the component that renders, not a
 * module-level import, or the UI will not re-render when the language changes.
 *
 * Finds top-level function declarations, matches their braces, and inserts the
 * hook into any body that references `t(` without already having one. Skips
 * non-component helpers (a plain function that happens to call t is left alone
 * only if it is not capitalised — hooks are illegal outside components).
 *
 * Usage:
 *   node scripts/add-translation-hooks.mjs src/pages/app-services-page.tsx
 */

import { readFileSync, writeFileSync } from 'node:fs'

function bodyRange(source, openBraceIndex) {
  let depth = 0
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return [openBraceIndex, i]
    }
  }
  return [openBraceIndex, source.length]
}

function main() {
  const files = process.argv.slice(2)

  for (const file of files) {
    let source = readFileSync(file, 'utf8')
    if (!source.includes("t('")) continue

    // Component declarations only: PascalCase names.
    const declPattern = /^(?:export\s+)?function\s+([A-Z]\w*)\s*\([\s\S]*?\)\s*(?::\s*[^{]+)?\{/gm
    const inserts = []

    for (const match of source.matchAll(declPattern)) {
      const open = source.indexOf('{', match.index + match[0].length - 1)
      const [start, end] = bodyRange(source, open)
      const body = source.slice(start, end)

      // Only the part of the body belonging to THIS component: nested
      // components declared inside would otherwise be counted here, but this
      // codebase declares them at top level, so the simple check holds.
      if (!/\bt\(/.test(body)) continue
      if (/useTranslation\(/.test(body)) continue

      inserts.push(start + 1)
    }

    // Apply from the end so earlier offsets stay valid.
    for (const at of inserts.sort((a, b) => b - a)) {
      source = source.slice(0, at) + "\n  const { t } = useTranslation()" + source.slice(at)
    }

    if (inserts.length > 0 && !/import\s+\{[^}]*useTranslation[^}]*\}\s+from\s+'react-i18next'/.test(source)) {
      // After the END of the import section. `lines.startsWith('import ')`
      // is not enough: a multi-line `import {` opens a brace, and inserting
      // straight after it lands INSIDE the specifier list.
      const lines = source.split('\n')
      let lastImportEnd = 0
      let inImport = false
      lines.forEach((line, i) => {
        if (/^import\s/.test(line)) inImport = true
        if (inImport && /(from\s+'[^']+'|^import\s+'[^']+')\s*;?\s*$/.test(line)) {
          lastImportEnd = i
          inImport = false
        }
      })
      lines.splice(lastImportEnd + 1, 0, "import { useTranslation } from 'react-i18next'")
      source = lines.join('\n')
    }

    writeFileSync(file, source)
    console.log(`${file}: ${inserts.length} hooks added`)
  }
}

main()
