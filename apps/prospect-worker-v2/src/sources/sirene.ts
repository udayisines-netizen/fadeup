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

interface SireneEtablissement {
  siren: string
  siret: string
  adresseEtablissement?: SireneAdresse
  uniteLegale?: {
    denominationUniteLegale?: string
    nomUniteLegale?: string
    prenom1UniteLegale?: string
    activitePrincipaleUniteLegale?: string
  }
}

interface SireneResponse {
  etablissements?: SireneEtablissement[]
}

// APE/NAF code for hairdressing establishments (France). See
// https://www.insee.fr/fr/metadonnees/nafr2 — "9602A Coiffure".
const HAIRDRESSING_NAF_CODE = '9602A'

/**
 * INSEE Sirene — France-only, official business registry. Third in the
 * France waterfall, after OSM/Geoapify: contributes SIREN/SIRET (a
 * high-confidence dedup identifier — see src/dedupe/candidates.ts) and
 * confirms legal/registered status. Requires INSEE_API_KEY (a bearer
 * token); isConfigured() false without one.
 *
 * NOTE: field names here follow INSEE Sirene API v3's documented
 * response shape. INSEE_API_KEY is not currently provisioned in this
 * environment (see infra/worker/.env.worker) — this adapter's live shape
 * has not been exercised against the real API and should be re-verified
 * against a fresh response the first time a real key is configured (see
 * docs/worker-v2/sources.md).
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
      ctx.logger.debug('sirene: skipped — France-only source', { country: query.country })
      return []
    }
    if (!query.city) {
      ctx.logger.debug('sirene: skipped — no city in query')
      return []
    }

    const q = [
      `activitePrincipaleUniteLegale:${HAIRDRESSING_NAF_CODE}`,
      `libelleCommuneEtablissement:"${query.city}"`,
      'etatAdministratifUniteLegale:A',
    ].join(' AND ')

    const url = new URL('https://api.insee.fr/entreprises/sirene/V3/siret')
    url.searchParams.set('q', q)
    url.searchParams.set('nombre', String(Math.min(query.maxCandidates ?? 50, 1000)))

    const response = await fetchJson<SireneResponse>(url.toString(), {
      headers: { Authorization: `Bearer ${this.config.INSEE_API_KEY}` },
      timeoutMs: 15_000,
    })

    return (response.etablissements ?? []).map((e) => etablissementToCandidate(e))
  }
}

function etablissementToCandidate(e: SireneEtablissement): RawCandidate {
  const legal = e.uniteLegale
  const name =
    legal?.denominationUniteLegale ??
    (legal?.prenom1UniteLegale && legal?.nomUniteLegale ? `${legal.prenom1UniteLegale} ${legal.nomUniteLegale}` : legal?.nomUniteLegale)

  const addr = e.adresseEtablissement
  const addressLine = [addr?.numeroVoieEtablissement, addr?.typeVoieEtablissement, addr?.libelleVoieEtablissement]
    .filter(Boolean)
    .join(' ')

  return {
    externalId: e.siret,
    externalType: 'siret',
    name,
    addressLine: addressLine || undefined,
    city: addr?.libelleCommuneEtablissement,
    postalCode: addr?.codePostalEtablissement,
    country: 'FR',
    // A registered legal entity match on the exact hairdressing NAF code
    // is a strong signal — high confidence, and siret is itself a
    // high-confidence dedup identifier (see src/dedupe/candidates.ts).
    confidence: 0.85,
    rawPayload: { siren: e.siren, siret: e.siret, uniteLegale: legal },
  }
}
