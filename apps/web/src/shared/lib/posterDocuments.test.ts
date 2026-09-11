import { describe, expect, it } from 'vitest'
import { A4, CM, canEncodeWinAnsi, textWidth, wrapText } from '@/shared/lib/pdf'
import { buildLetterPdf, buildPosterPdf, canPrintTexts, posterUrl } from '@/shared/lib/posterDocuments'
import { svgPathToPdfOps } from '@/shared/lib/svgPathToPdf'
import { FADEUP_MARK_ARCS, FADEUP_MARK_VIEWBOX } from '@/shared/lib/fadeupBrandPaths'

const COPY = {
  headline: 'Votre tour, en direct sur votre téléphone.',
  action: 'Scannez, suivez votre tour en direct, sortez prendre un café.',
  codeLabel: 'Code de cette affiche',
  fallbackLabel: 'fade-up.com',
}

function asText(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return out
}

describe('le PDF des affiches', () => {
  it('est un PDF valide, avec une page par code', () => {
    const pdf = buildPosterPdf(['ABCDEFGHJK', 'MNPQRSTVWX'], 'https://fade-up.com', COPY)
    const text = asText(pdf)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(text).toContain('/Count 2')
    // La table xref doit annoncer autant d'entrées qu'il y a d'objets.
    const size = /\/Size (\d+)/.exec(text)?.[1]
    const xrefHeader = /xref\n0 (\d+)\n/.exec(text)?.[1]
    expect(size).toBe(xrefHeader)
  })

  it('pose chaque décalage xref sur le début réel de son objet', () => {
    const pdf = buildPosterPdf(['ABCDEFGHJK'], 'https://fade-up.com', COPY)
    const text = asText(pdf)
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(offsets.length).toBeGreaterThan(4)
    offsets.forEach((offset, index) => {
      // Un décalage faux produit un PDF que certains lecteurs réparent en
      // silence et que d'autres refusent : c'est le défaut qui ne se voit
      // qu'à l'impression, donc il se teste ici.
      expect(text.slice(offset, offset + 20)).toMatch(new RegExp(`^${index + 1} 0 obj`))
    })
  })

  it('imprime le QR à au moins huit centimètres de côté', () => {
    const pdf = buildPosterPdf(['ABCDEFGHJK'], 'https://fade-up.com', COPY)
    const text = asText(pdf)
    // Le fond blanc du QR est le premier grand carré dessiné après le fond de
    // page : on relit sa taille dans le flux.
    const squares = [...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)]
      .map((m) => ({ w: Number(m[3]), h: Number(m[4]) }))
      .filter((s) => Math.abs(s.w - s.h) < 0.01 && s.w > 100)
    const qrSquare = squares[0]
    expect(qrSquare).toBeDefined()
    expect(qrSquare?.w).toBeGreaterThanOrEqual(8 * CM)
    expect(qrSquare?.w).toBeLessThanOrEqual(A4.width - 2 * CM)
  })

  it('porte le code EN CLAIR sur la page, pour le cas où l’impression est abîmée', () => {
    const pdf = buildPosterPdf(['ABCDEFGHJK'], 'https://fade-up.com', COPY)
    expect(asText(pdf)).toContain('(ABCDEFGHJK) Tj')
  })

  it('encode l’URL courte du code dans le QR', () => {
    expect(posterUrl('https://fade-up.com', 'ABCDEFGHJK')).toBe('https://fade-up.com/a/ABCDEFGHJK')
  })

  it('échappe les parenthèses et les accents sans casser le flux', () => {
    const pdf = buildPosterPdf(['ABCDEFGHJK'], 'https://fade-up.com', {
      ...COPY,
      headline: 'Café (offert) \\ ici',
    })
    const text = asText(pdf)
    expect(text).toContain('\\(offert\\)')
    expect(text).toContain('\\\\')
    // é en WinAnsi vaut 0xE9, et non deux octets UTF-8.
    expect(text).toContain(String.fromCharCode(0xe9))
  })
})

describe('la lettre', () => {
  const LETTER = {
    code: 'ABCDEFGHJK',
    origin: 'https://fade-up.com',
    businessName: 'Salon Test',
    addressLines: ['1 rue du Test', '93200 Saint-Denis'],
    copy: {
      salutation: 'Madame, Monsieur,',
      body: 'Un texte générique.',
      proofHeading: 'Ce que nous avons mesuré',
      proofLines: ['128 vues de votre fiche'],
      callToAction: 'Scannez le code.',
      signature: 'FadeUp',
      codeLabel: 'Votre code',
    },
  }

  it('porte le nom du salon, son adresse, le code et la preuve', () => {
    const text = asText(buildLetterPdf(LETTER))
    expect(text).toContain('(Salon Test) Tj')
    expect(text).toContain('(1 rue du Test) Tj')
    expect(text).toContain('(ABCDEFGHJK) Tj')
    expect(text).toContain('(128 vues de votre fiche) Tj')
  })

  it('n’imprime AUCUN encadré de preuve quand l’analytics ne dit rien', () => {
    const text = asText(buildLetterPdf({ ...LETTER, copy: { ...LETTER.copy, proofLines: [] } }))
    expect(text).not.toContain('(Ce que nous avons mesuré) Tj')
  })
})

describe('l’encodage WinAnsi', () => {
  it('accepte le latin étendu', () => {
    expect(canEncodeWinAnsi('Café, señor, ação, Grüße')).toBe(true)
  })

  it('refuse ce que les polices standard ne savent pas écrire', () => {
    expect(canEncodeWinAnsi('列に並ぶ')).toBe(false)
    expect(canEncodeWinAnsi('طابور')).toBe(false)
    expect(canPrintTexts(['ok', 'очередь'])).toBe(false)
  })
})

describe('la mise en page', () => {
  it('mesure et coupe le texte sans dépasser la largeur donnée', () => {
    const lines = wrapText('un deux trois quatre cinq six sept huit neuf dix', 60, 11)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(textWidth(line, 11)).toBeLessThanOrEqual(60.5)
  })
})

describe('le logo', () => {
  it('traduit les arcs du mark en cubiques, sans perdre le point de départ', () => {
    const ops = svgPathToPdfOps(FADEUP_MARK_ARCS[0], { viewBox: FADEUP_MARK_VIEWBOX, x: 0, y: 0, width: 100 })
    expect(ops).toMatch(/^52\.96 83\.87 m/)
    expect(ops.split('\n').filter((l) => l.endsWith(' c')).length).toBeGreaterThan(0)
  })

  it('lève sur une commande de tracé inconnue plutôt que de dessiner un faux logo', () => {
    expect(() => svgPathToPdfOps('M0 0 S1 1 2 2', { viewBox: FADEUP_MARK_VIEWBOX, x: 0, y: 0, width: 100 })).toThrow()
  })
})

/**
 * LA PREUVE QUI COMPTE : le QR imprimé se relit.
 *
 * Vérifier qu'un carré de neuf centimètres existe ne prouve rien — un carré
 * noir aussi mesure neuf centimètres. Ce test-ci REMBOBINE le flux de la
 * page : il rejoue les rectangles pleins du PDF sur une trame, puis passe la
 * trame au décodeur `jsQR`, celui-là même qui sert au scanner de FadeUp. Si
 * la géométrie du QR est fausse d'un module, d'une inversion ou d'une zone
 * de silence, il ne décode pas.
 */
describe('le QR imprimé', () => {
  it('se relit, et pointe sur l’URL du code', async () => {
    const jsQR = (await import('jsqr')).default
    const pdf = buildPosterPdf(['ABCDEFGHJK'], 'https://fade-up.com', COPY)
    const text = asText(pdf)

    // Le flux de la première page, entre son `stream` et son `endstream`.
    const stream = /stream\n([\s\S]*?)\nendstream/.exec(text)?.[1] ?? ''
    const scale = 2
    const width = Math.ceil(A4.width * scale)
    const height = Math.ceil(A4.height * scale)
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255)

    let fill: [number, number, number] = [0, 0, 0]
    for (const line of stream.split('\n')) {
      const color = /^([\d.]+) ([\d.]+) ([\d.]+) rg$/.exec(line)
      if (color) {
        fill = [Number(color[1] ?? 0) * 255, Number(color[2] ?? 0) * 255, Number(color[3] ?? 0) * 255]
        continue
      }
      const rect = /^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f$/.exec(line)
      if (!rect) continue
      const [x = 0, y = 0, w = 0, h = 0] = rect.slice(1).map(Number)
      // PDF monte, une trame descend.
      const left = Math.round(x * scale)
      const top = Math.round((A4.height - y - h) * scale)
      for (let row = top; row < Math.round((A4.height - y) * scale); row += 1) {
        for (let col = left; col < Math.round((x + w) * scale); col += 1) {
          if (row < 0 || row >= height || col < 0 || col >= width) continue
          const index = (row * width + col) * 4
          pixels[index] = fill[0]
          pixels[index + 1] = fill[1]
          pixels[index + 2] = fill[2]
        }
      }
    }

    const decoded = jsQR(pixels, width, height)
    expect(decoded?.data).toBe('https://fade-up.com/a/ABCDEFGHJK')
  })
})
