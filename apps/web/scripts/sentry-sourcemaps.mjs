#!/usr/bin/env node
/**
 * X1 — téléversement des cartes source vers Sentry, hors du chemin de deploy.
 *
 * Principe : la build servie ne contient JAMAIS de .map (vite.config.ts ne
 * les émet que sous SENTRY_SOURCEMAPS=1, et ce script les supprime après
 * envoi). L'association se fait par release : le même identifiant
 * VITE_SENTRY_RELEASE doit être passé à la build Docker déployée et à ce
 * script. Avec `sourcemap: 'hidden'`, le JS émis ici est identique octet
 * pour octet à celui de la build de production — Sentry peut donc résoudre
 * les traces du bundle servi avec les cartes envoyées ici.
 *
 * Prérequis (voir README-sentry.md) :
 *   SENTRY_AUTH_TOKEN   jeton d'organisation, scope project:releases —
 *                       C'EST UN SECRET : uniquement en variable
 *                       d'environnement, jamais dans un fichier suivi.
 *   SENTRY_ORG          slug de l'organisation
 *   SENTRY_PROJECT      slug du projet
 *   VITE_SENTRY_RELEASE identifiant de release (recommandé : git describe)
 *
 * Usage : node scripts/sentry-sourcemaps.mjs
 */
import { execSync } from 'node:child_process'
import { globSync, rmSync } from 'node:fs'

for (const name of ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'VITE_SENTRY_RELEASE']) {
  if (!process.env[name]) {
    console.error(`sentry-sourcemaps: ${name} manquant — voir README-sentry.md`)
    process.exit(2)
  }
}

const release = process.env.VITE_SENTRY_RELEASE
const run = (cmd, env = {}) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } })

// 1. Build avec cartes cachées (JS identique à la build de production).
run('npm run build', { SENTRY_SOURCEMAPS: '1' })

// 2. Téléversement, associé à la release. --url-prefix aligne les chemins
//    sur la façon dont nginx sert le bundle (/assets/...).
run(
  `npx @sentry/cli releases files "${release}" upload-sourcemaps dist/assets ` +
    `--url-prefix '~/assets' --validate`,
)
run(`npx @sentry/cli releases finalize "${release}"`)

// 3. Suppression locale des .map : rien ne doit pouvoir être servi.
const maps = globSync('dist/**/*.map')
for (const f of maps) rmSync(f)
console.log(`sentry-sourcemaps: ${maps.length} carte(s) envoyée(s) puis supprimée(s) de dist/`)
