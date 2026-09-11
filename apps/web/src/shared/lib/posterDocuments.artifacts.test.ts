import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildMailingPdf, buildPosterPdf } from '@/shared/lib/posterDocuments'
import fr from '@/locales/fr/platform.json'

/**
 * PLAT-2 — fabrique les DEUX documents avec les VRAIES chaînes traduites et
 * les archive sur disque, pour qu'on puisse les OUVRIR au lieu de me croire.
 *
 * Ne tourne que sur demande : `PLAT2_PDF_OUT=<dossier> vitest run
 * src/shared/lib/posterDocuments.artifacts.test.ts`. Sans la variable, le
 * test se saute — une suite qui écrit des fichiers à chaque passage est une
 * suite qui salit le dépôt.
 */
const OUT = process.env.PLAT2_PDF_OUT

describe('les artefacts PDF', () => {
  it.skipIf(!OUT)('se fabriquent avec les chaînes françaises réelles', () => {
    const copy = fr.posters
    const posterCopy = {
      headline: copy.pdfHeadline,
      action: copy.pdfAction,
      codeLabel: copy.pdfCodeLabel,
      fallbackLabel: copy.pdfFallback.replace('{{origin}}', 'fade-up.com'),
    }
    mkdirSync(OUT as string, { recursive: true })
    writeFileSync(`${OUT}/affiche-fr.pdf`, buildPosterPdf(['QAPFREE001', 'QAPASGND03'], 'https://fade-up.com', posterCopy))
    writeFileSync(
      `${OUT}/envoi-fr.pdf`,
      buildMailingPdf(
        {
          code: 'QAPFREE001',
          origin: 'https://fade-up.com',
          businessName: 'Salon Exemple',
          addressLines: ['12 rue de la République', '93200 Saint-Denis', 'France'],
          copy: {
            salutation: copy.letterSalutation,
            body: copy.letterBody,
            proofHeading: copy.letterProofHeading,
            proofLines: [
              '128 personnes ont ouvert votre fiche FadeUp au cours des 90 derniers jours.',
              '3 clients ont demandé un rendez-vous chez vous.',
            ],
            callToAction: copy.letterCallToAction,
            signature: copy.letterSignature,
            codeLabel: copy.letterCodeLabel,
          },
        },
        posterCopy,
      ),
    )
    // Relu depuis le disque : on vérifie le FICHIER, pas la mémoire.
    const poster = readFileSync(`${OUT}/affiche-fr.pdf`, 'latin1')
    expect(poster.startsWith('%PDF-1.4')).toBe(true)
    expect(poster).toContain('(QAPFREE001) Tj')
    const mailing = readFileSync(`${OUT}/envoi-fr.pdf`, 'latin1')
    expect(mailing).toContain('/Count 2')
    expect(mailing).toContain('(Salon Exemple) Tj')
  })
})
