// Minimal E.164 normalizer — deliberately NOT a full libphonenumber-style
// dependency. Covers the calling codes FadeUp's initial markets need
// (see spec: France is the primary/only fully-waterfalled country for
// V1) plus a handful of others, and returns `null` rather than guessing
// when there isn't enough geographic context — per spec: "normalize
// phone numbers to E.164 WHEN ENOUGH GEOGRAPHIC CONTEXT EXISTS."
const COUNTRY_CALLING_CODES: Record<string, string> = {
  FR: '33',
  BE: '32',
  CH: '41',
  LU: '352',
  MC: '377',
  GB: '44',
  US: '1',
  CA: '1',
  DE: '49',
  ES: '34',
  IT: '39',
  NL: '31',
  PT: '351',
}

/** Normalizes a raw phone string to E.164 (+33612345678) given an ISO-3166 alpha-2 country hint. Returns null if the input can't be confidently normalized — callers should keep the raw value separately rather than discard it (see spec: "preserve raw source values separately when necessary"). */
export function normalizePhoneE164(raw: string | undefined | null, countryHint: string | undefined | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Already E.164-shaped.
  if (/^\+[1-9]\d{6,14}$/.test(trimmed.replace(/[\s().-]/g, ''))) {
    return trimmed.replace(/[\s().-]/g, '')
  }

  const digitsOnly = trimmed.replace(/[^\d+]/g, '')

  // 00-prefixed international format.
  if (digitsOnly.startsWith('00')) {
    const candidate = '+' + digitsOnly.slice(2)
    return /^\+[1-9]\d{6,14}$/.test(candidate) ? candidate : null
  }

  if (digitsOnly.startsWith('+')) {
    return /^\+[1-9]\d{6,14}$/.test(digitsOnly) ? digitsOnly : null
  }

  if (!countryHint) return null
  const callingCode = COUNTRY_CALLING_CODES[countryHint.toUpperCase()]
  if (!callingCode) return null

  // National format with a leading trunk 0 (common in FR/BE/GB/...).
  const nationalDigits = digitsOnly.replace(/^0/, '')
  if (nationalDigits.length < 6 || nationalDigits.length > 14) return null

  const candidate = `+${callingCode}${nationalDigits}`
  return /^\+[1-9]\d{6,14}$/.test(candidate) ? candidate : null
}
