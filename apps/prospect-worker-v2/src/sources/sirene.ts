import type { Config } from '../config.js'
import { fetchJson } from '../http.js'
import type { DiscoveryQuery, RawCandidate, SourceAdapter, SourceAdapterContext } from './types.js'

interface SireneAdresse {
  numeroVoieEtablissement?: string
  typeVoieEtablissement?: string
  libelleVoieEtablissement?: string
  codePostalEtablissement?: string
  libelleCommuneEtablissement?: string
}

interface SirenePeriodeEtablissement {
  dateDebut?: string | null
  dateFin?: string | null
  etatAdministratifEtablissement?: string
  activitePrincipaleEtablissement?: string
  enseigne1Etablissement?: string | null
}

interface SireneEtablissement {
  siren: string
  siret: string
  adresseEtablissement?: SireneAdresse
  periodesEtablissement?: SirenePeriodeEtablissement[]
  uniteLegale?: {
    denominationUniteLegale?: string
    nomUniteLegale?: string
    prenom1UniteLegale?: string
  }
}

interface SireneResponse {
  etablissements?: SireneEtablissement[]
}

// NAF 96.02A — Coiffure.
// We query establishment-level activity because FadeUp discovers physical
// establishments, not merely legal units.
const HAIRDRESSING_NAF_CODE = '96.02A'

const SIRENE_BASE_URL = 'https://api.insee.fr/api-sirene/3.11'

/**
 * INSEE Sirene — France-only official business registry.
 *
 * Sirene is primarily an administrative/trust source for FadeUp:
 * - SIREN/SIRET
 * - legal/business identity
 * - physical establishment address
 * - activity code
 * - current active/closed state
 *
 * It is NOT treated as a contact-data source for phone/email.
 *
 * Authentication uses the current public INSEE API key header:
 * X-INSEE-Api-Key-Integration.
 */
export class SireneAdapter implements SourceAdapter {
  readonly key = 'sirene'
  readonly displayName = 'INSEE Sirene'

  constructor(private readonly config: Config) {}

  isConfigured(): boolean {
    return Boolean(this.config.INSEE_API_KEY)
  }

  async discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]> {
    if (!this.isConfigured()) {
      throw new Error('sirene: INSEE_API_KEY not configured')
    }

    if (query.country !== 'FR') {
      ctx.logger.debug('sirene: skipped — France-only source', {
        country: query.country,
      })
      return []
    }

    if (!query.city) {
      ctx.logger.debug('sirene: skipped — no city in query')
      return []
    }

    const today = new Date().toISOString().slice(0, 10)
    const city = escapeSirenePhrase(query.city.trim().toUpperCase())

    /*
     * establishment activity/state are historised Sirene fields.
     * `periode(...)` + `date=<today>` means:
     * "this physical establishment is active and classified 96.02A today",
     * rather than "it had such a state at some point in its history".
     */
    const q =
      `periode(` +
      `etatAdministratifEtablissement:A AND ` +
      `activitePrincipaleEtablissement:${HAIRDRESSING_NAF_CODE}` +
      `) AND ` +
      `libelleCommuneEtablissement:"${city}"`

    const url = new URL(`${SIRENE_BASE_URL}/siret`)
    url.searchParams.set('q', q)
    url.searchParams.set('date', today)
    url.searchParams.set(
      'nombre',
      String(Math.min(query.maxCandidates ?? 50, 1000)),
    )

    const response = await fetchJson<SireneResponse>(url.toString(), {
      headers: {
        'X-INSEE-Api-Key-Integration': this.config.INSEE_API_KEY!,
        Accept: 'application/json',
      },
      timeoutMs: 15_000,
    })

    return (response.etablissements ?? [])
      .map((e) => etablissementToCandidate(e, today))
      .filter((candidate): candidate is RawCandidate => candidate !== null)
  }
}

function etablissementToCandidate(
  e: SireneEtablissement,
  date: string,
): RawCandidate | null {
  const currentPeriod =
    e.periodesEtablissement?.find(
      (period) =>
        (!period.dateDebut || period.dateDebut <= date) &&
        (!period.dateFin || period.dateFin >= date),
    ) ?? e.periodesEtablissement?.[0]

  // Defensive check: the API query should already guarantee both conditions,
  // but never manufacture a current FadeUp prospect from a closed or
  // non-hairdressing establishment if the upstream response changes.
  if (
    currentPeriod &&
    (currentPeriod.etatAdministratifEtablissement !== 'A' ||
      currentPeriod.activitePrincipaleEtablissement !== HAIRDRESSING_NAF_CODE)
  ) {
    return null
  }

  const legal = e.uniteLegale

  const name =
    currentPeriod?.enseigne1Etablissement ??
    legal?.denominationUniteLegale ??
    (legal?.prenom1UniteLegale && legal?.nomUniteLegale
      ? `${legal.prenom1UniteLegale} ${legal.nomUniteLegale}`
      : legal?.nomUniteLegale)

  if (!name?.trim()) {
    return null
  }

  const addr = e.adresseEtablissement

  const addressLine = [
    addr?.numeroVoieEtablissement,
    addr?.typeVoieEtablissement,
    addr?.libelleVoieEtablissement,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    externalId: e.siret,
    externalType: 'siret',
    name: name.trim(),
    addressLine: addressLine || undefined,
    city: addr?.libelleCommuneEtablissement,
    postalCode: addr?.codePostalEtablissement,
    country: 'FR',

    // Exact SIRET + active physical establishment + exact NAF activity
    // is strong administrative evidence for identity/deduplication.
    confidence: 0.85,

    rawPayload: {
      siren: e.siren,
      siret: e.siret,
      activityCode: currentPeriod?.activitePrincipaleEtablissement ?? null,
      administrativeState:
        currentPeriod?.etatAdministratifEtablissement ?? null,
      referenceDate: date,
    },
  }
}

function escapeSirenePhrase(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
