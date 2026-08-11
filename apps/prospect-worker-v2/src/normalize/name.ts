/** Normalizes a business name for comparison/dedup purposes: lowercase, accents stripped, punctuation collapsed, common legal-form/business-word suffixes removed, whitespace collapsed. NEVER used to overwrite the display name shown to a human — only for matching. */
export function normalizeBusinessName(raw: string | undefined | null): string {
  if (!raw) return ''

  // NFD decomposes accented letters into base + combining mark
  // (Café -> Cafe + U+0301); stripping the U+0300-U+036F combining
  // diacritical marks block then leaves plain ASCII letters.
  let s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const noiseWords = [
    'barbershop', 'barber shop', 'barbier', 'salon de coiffure', 'coiffure',
    'hairdresser', 'hair salon', 'the', 'le', 'la', 'les', 'sarl', 'sas', 'sasu', 'eurl',
  ]
  for (const word of noiseWords) {
    s = s.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ')
  }

  return s.replace(/\s+/g, ' ').trim()
}
