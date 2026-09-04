#!/usr/bin/env node
/**
 * Garde anti-régression du contraste (P1b §5) : dans un thème CLAIR,
 * `--fu-accent-fg` est l'encre `#080F0D` (8,30:1 sur le vert primaire) et
 * n'est JAMAIS blanc (2,33:1 — l'échec exact de la version précédente).
 * Exécuté par `npm run lint` : toute dérive échoue le build.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []

const LIGHT_THEMES = ['src/styles/tokens-consumer.css']
for (const file of LIGHT_THEMES) {
  const css = readFileSync(join(root, file), 'utf8')
  const matches = [...css.matchAll(/--fu-accent-fg:\s*([^;]+);/g)].map((m) => m[1].trim().toLowerCase())
  if (matches.length === 0) {
    failures.push(`${file}: --fu-accent-fg absent`)
  }
  for (const value of matches) {
    if (!value.startsWith('#080f0d')) {
      failures.push(`${file}: --fu-accent-fg vaut « ${value} » — doit être #080F0D (jamais blanc, 2,33:1)`)
    }
  }
  if (/--fu-accent-fg:\s*#fff/i.test(css)) {
    failures.push(`${file}: --fu-accent-fg blanc détecté`)
  }
}

// Les thèmes sombres gardent aussi l'encre sur vert (le vert reste clair).
for (const file of ['src/styles/tokens-pro.css', 'src/styles/tokens-editorial.css']) {
  const css = readFileSync(join(root, file), 'utf8')
  if (/--fu-accent-fg:\s*#f/i.test(css)) {
    failures.push(`${file}: --fu-accent-fg clair sur vert — interdit`)
  }
}

if (failures.length > 0) {
  console.error('✗ Garde palette FadeUp :')
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}
console.log('✓ Garde palette FadeUp : --fu-accent-fg = encre dans tous les thèmes')
