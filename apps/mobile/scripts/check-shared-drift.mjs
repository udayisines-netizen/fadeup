#!/usr/bin/env node
/**
 * M1a — garde anti-dérive de la logique partagée avec apps/web.
 *
 * DÉCISION (M1a §2) : les modules purs sont COPIÉS, pas importés à travers
 * les racines de paquet. Motif : aucun workspace npm n'existe à la racine du
 * dépôt, et P1PRO travaille en parallèle sur apps/web — un import vivant
 * ferait casser le mobile par un lot qui n'en sait rien. La copie rend le
 * mobile hermétique ; CE script rend la dérive VISIBLE au lieu de silencieuse.
 *
 * Deux régimes :
 *   - verbatim : le fichier mobile doit être IDENTIQUE à l'original web ;
 *   - adapted  : le fichier mobile diverge volontairement (adaptation
 *     déclarée) — on fige alors le hash de L'ORIGINAL web ; s'il change,
 *     le script échoue pour forcer une re-revue de l'adaptation.
 *
 * Usage : node scripts/check-shared-drift.mjs   (exit 1 à la moindre dérive)
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mobile = resolve(here, '..')
const web = resolve(here, '../../web')

/** mobile → { web, mode, webSha256? } */
const MANIFEST = {
  'src/shared/lib/database.types.ts': { web: 'src/shared/lib/database.types.ts', mode: 'verbatim' },
  'src/shared/lib/serviceState.ts': { web: 'src/shared/lib/serviceState.ts', mode: 'verbatim' },
  'src/shared/lib/waitTime.ts': { web: 'src/shared/lib/waitTime.ts', mode: 'verbatim' },
  'src/shared/lib/openingHours.ts': { web: 'src/shared/lib/openingHours.ts', mode: 'verbatim' },
  'src/shared/data/keys.ts': { web: 'src/shared/data/keys.ts', mode: 'verbatim' },
  'src/shared/data/discovery.ts': { web: 'src/shared/data/discovery.ts', mode: 'verbatim' },
  'src/shared/data/postMedia.ts': { web: 'src/shared/data/postMedia.ts', mode: 'verbatim' },
  // format.ts : `import.meta.env.DEV` → `__DEV__` (Metro ne supporte pas
  // import.meta) — seule adaptation, déclarée en tête de fichier.
  'src/shared/lib/format.ts': {
    web: 'src/shared/lib/format.ts',
    mode: 'adapted',
    webSha256: '1e91dde8c7b96274b2135063e8c7ec44d2eefc5d3ec4ef7f6c3d513d6097dda7',
  },
  // searchRanking.ts : verbatim — le contrat ProfessionalSearchRow vit au
  // même alias `@/shared/data/discovery` côté mobile.
  'src/shared/lib/searchRanking.ts': { web: 'src/shared/lib/searchRanking.ts', mode: 'verbatim' },
  // demoMedia.ts : les bannières de démonstration sont servies par le web de
  // production (URL absolue) — le registre de slugs doit rester le même.
  'src/shared/lib/demoMedia.ts': {
    web: 'src/shared/lib/demoMedia.ts',
    mode: 'adapted',
    webSha256: '57eeba3b947dd5f1d883db158e8c0b3ed77728a9881bd11272420235b5e4d832',
  },
  // M1b — file, réservation, auth légère : les couches pures et data du web
  // (F1/F1b/F4/P1PRO) sont propres de tout global web et portent des imports
  // `@/` identiques des deux côtés — copies verbatim, tests compris.
  'src/shared/lib/bookingRefusals.ts': { web: 'src/shared/lib/bookingRefusals.ts', mode: 'verbatim' },
  'src/shared/lib/bookingRefusals.test.ts': { web: 'src/shared/lib/bookingRefusals.test.ts', mode: 'verbatim' },
  'src/shared/lib/deadline.ts': { web: 'src/shared/lib/deadline.ts', mode: 'verbatim' },
  'src/shared/lib/deadline.test.ts': { web: 'src/shared/lib/deadline.test.ts', mode: 'verbatim' },
  'src/shared/lib/queueLink.ts': { web: 'src/shared/lib/queueLink.ts', mode: 'verbatim' },
  'src/shared/lib/queueLink.test.ts': { web: 'src/shared/lib/queueLink.test.ts', mode: 'verbatim' },
  'src/shared/hooks/useNow.ts': { web: 'src/shared/hooks/useNow.ts', mode: 'verbatim' },
  'src/shared/data/publicQueue.ts': { web: 'src/shared/data/publicQueue.ts', mode: 'verbatim' },
  'src/shared/data/capability.ts': { web: 'src/shared/data/capability.ts', mode: 'verbatim' },
  'src/features/queue/lib/refusals.ts': { web: 'src/features/queue/lib/refusals.ts', mode: 'verbatim' },
  'src/features/queue/lib/refusals.test.ts': { web: 'src/features/queue/lib/refusals.test.ts', mode: 'verbatim' },
  'src/features/queue/api/publicQueue.ts': { web: 'src/features/queue/api/publicQueue.ts', mode: 'verbatim' },
  'src/features/queue/api/lightAuth.ts': { web: 'src/features/queue/api/lightAuth.ts', mode: 'verbatim' },
  'src/features/booking/lib/refusals.ts': { web: 'src/features/booking/lib/refusals.ts', mode: 'verbatim' },
  'src/features/booking/lib/deadline.ts': { web: 'src/features/booking/lib/deadline.ts', mode: 'verbatim' },
  'src/features/booking/lib/slots.ts': { web: 'src/features/booking/lib/slots.ts', mode: 'verbatim' },
  'src/features/booking/lib/slots.test.ts': { web: 'src/features/booking/lib/slots.test.ts', mode: 'verbatim' },
  'src/features/booking/api/booking.ts': { web: 'src/features/booking/api/booking.ts', mode: 'verbatim' },
  'src/features/booking/api/lightAuth.ts': { web: 'src/features/booking/api/lightAuth.ts', mode: 'verbatim' },
  // localQueueEntry.ts : localStorage synchrone → AsyncStorage asynchrone
  // (même contrat, même clé, même validation) — adaptation déclarée en tête.
  'src/shared/lib/localQueueEntry.ts': {
    web: 'src/shared/lib/localQueueEntry.ts',
    mode: 'adapted',
    webSha256: '29cb69b005ae00c098e3418c5240a451c3390e26c1a124603d11239123ead425',
  },
}

const I18N_DIRS = ['src/shared/i18n/locales/fr', 'src/shared/i18n/locales/en']

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

let failures = 0
const fail = (msg) => {
  failures += 1
  console.error(`DRIFT: ${msg}`)
}

for (const [mobilePath, spec] of Object.entries(MANIFEST)) {
  const m = resolve(mobile, mobilePath)
  const w = resolve(web, spec.web)
  if (spec.mode === 'verbatim') {
    if (sha(m) !== sha(w)) fail(`${mobilePath} diverge de apps/web/${spec.web} (copie verbatim attendue)`)
  } else {
    const current = sha(w)
    if (current !== spec.webSha256) {
      fail(
        `apps/web/${spec.web} a changé depuis la copie adaptée (${current.slice(0, 12)}…) — ` +
          `re-passer l'adaptation de ${mobilePath} puis mettre à jour le hash du manifeste`,
      )
    }
  }
}

// Catalogues i18n : chaque section web doit exister à l'identique côté mobile
// (le mobile peut AJOUTER des sections à lui — mobile.json — jamais en modifier).
for (const dir of I18N_DIRS) {
  const webDir = resolve(web, dir.replace('src/shared/i18n', 'src/shared/i18n'))
  for (const file of readdirSync(webDir).filter((f) => f.endsWith('.json'))) {
    const m = resolve(mobile, dir, file)
    try {
      if (sha(m) !== sha(resolve(webDir, file))) fail(`${dir}/${file} diverge du catalogue web`)
    } catch {
      fail(`${dir}/${file} manquant côté mobile (section web non copiée)`)
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} dérive(s) détectée(s) entre apps/mobile et apps/web.`)
  process.exit(1)
}
console.log('Logique partagée : aucune dérive avec apps/web.')
