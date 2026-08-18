import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF protection for the website-enrichment crawler.
 *
 * The crawler fetches URLs that came from third-party APIs and from page
 * content — i.e. attacker-influenceable input. Without this guard, a
 * prospect whose "website" is http://169.254.169.254/latest/meta-data/
 * would make the Worker fetch its own cloud metadata and store the result.
 *
 * Two checks, both required:
 *   1. Scheme/port/shape validation on the URL itself.
 *   2. DNS resolution, with EVERY resolved address checked against the
 *      blocked ranges. Checking the hostname alone is useless — a public
 *      name can resolve to 127.0.0.1.
 *
 * Callers must ALSO re-validate on every redirect hop, which is why
 * crawl.ts sets redirect: 'manual' and walks hops itself.
 */

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Only the standard web ports. A business website on :22 or :6379 is not a
 * business website — it is someone probing our egress.
 */
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443'])

/** Hostnames that never point anywhere legitimate for this crawler. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud metadata services, by their documented names.
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

/** Hostname suffixes that indicate an internal/service-mesh address. */
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.cluster.local']

/**
 * Docker/Compose service names the FadeUp stack itself uses. The crawler
 * shares a network with these, so a hostile "website" value could
 * otherwise reach Supabase directly from inside the perimeter.
 */
const BLOCKED_SERVICE_NAMES = [
  'fadeup-supabase-db',
  'fadeup-supabase-rest',
  'fadeup-supabase-auth',
  'fadeup-supabase-kong',
  'fadeup-supabase-storage',
  'fadeup-supabase-studio',
  'fadeup-supabase-meta',
  'fadeup-prospect-worker-v2',
  'kong',
  'db',
  'rest',
  'auth',
  'storage',
]

/**
 * Returns a reason string when `address` is in a non-public range, or null
 * when it is a routable public address.
 */
export function blockedIpReason(address: string): string | null {
  const version = isIP(address)
  if (version === 4) return blockedIpv4Reason(address)
  if (version === 6) return blockedIpv6Reason(address)
  return 'not_an_ip'
}

function blockedIpv4Reason(address: string): string | null {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return 'malformed_ipv4'
  }
  const [a, b] = parts as [number, number, number, number]

  if (a === 0) return 'this_network'
  if (a === 127) return 'loopback'
  if (a === 10) return 'rfc1918_private'
  if (a === 172 && b >= 16 && b <= 31) return 'rfc1918_private'
  if (a === 192 && b === 168) return 'rfc1918_private'
  // Carrier-grade NAT — shared address space, not publicly routable.
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat_shared'
  // Link-local, which includes the 169.254.169.254 cloud metadata endpoint.
  if (a === 169 && b === 254) return 'link_local_or_metadata'
  if (a === 192 && b === 0) return 'ietf_protocol_assignments'
  if (a === 198 && (b === 18 || b === 19)) return 'benchmarking'
  if (a >= 224 && a <= 239) return 'multicast'
  if (a >= 240) return 'reserved'

  return null
}

function blockedIpv6Reason(address: string): string | null {
  const normalized = address.toLowerCase().split('%')[0] ?? ''

  if (normalized === '::' || normalized === '::0') return 'unspecified'
  if (normalized === '::1') return 'loopback'

  // IPv4-mapped (::ffff:127.0.0.1) — must be checked as IPv4, otherwise
  // loopback slips through as "a v6 address".
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped?.[1]) {
    return blockedIpv4Reason(mapped[1]) ?? null
  }
  // IPv4-mapped in hex form.
  if (normalized.startsWith('::ffff:')) return 'ipv4_mapped_unresolvable'

  if (normalized.startsWith('fe80')) return 'link_local'
  // Unique local addresses fc00::/7.
  if (/^f[cd]/.test(normalized)) return 'unique_local'
  if (normalized.startsWith('ff')) return 'multicast'
  // 64:ff9b::/96 NAT64, and 2002::/16 6to4 — both can be used to reach
  // an embedded IPv4 address that our v4 rules would otherwise block.
  if (normalized.startsWith('64:ff9b:')) return 'nat64'
  if (normalized.startsWith('2002:')) return '6to4'

  return null
}

/**
 * The only DNS capability this module needs: resolve a hostname to every
 * address it maps to.
 *
 * Declared narrowly rather than as the full `dns/promises.lookup` type so
 * a test can substitute a plain stub without reproducing that function's
 * five overloads — and so it is obvious that nothing here depends on
 * lookup's single-address modes.
 */
export type DnsResolver = (hostname: string, options: { all: true }) => Promise<{ address: string }[]>

export interface SsrfCheckResult {
  url: URL
  /** Every address the hostname resolved to. All were validated. */
  resolvedAddresses: string[]
}

/**
 * Validates a URL and its DNS resolution. Throws SsrfBlockedError on any
 * violation; returns the parsed URL and resolved addresses on success.
 *
 * NOTE on TOCTOU: a hostile DNS server could return a public address here
 * and a private one when fetch() resolves independently (DNS rebinding).
 * Fully closing that requires pinning the connection to the validated IP,
 * which Node's fetch does not expose. The residual risk is accepted and
 * documented rather than silently ignored: this check blocks the entire
 * realistic attack surface (a website field pointing at an internal
 * address), and the crawler additionally refuses non-HTML content, caps
 * response size, and never echoes response bodies back to any client.
 */
export async function assertUrlIsSafe(rawUrl: string, resolver: DnsResolver = lookup): Promise<SsrfCheckResult> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError(`not a valid absolute URL: ${rawUrl}`, 'invalid_url')
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(`protocol ${url.protocol} is not allowed`, 'protocol_not_allowed')
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new SsrfBlockedError(`port ${url.port} is not allowed`, 'port_not_allowed')
  }

  // Credentials in a URL are never legitimate for a public business site
  // and are a classic way to confuse host parsing.
  if (url.username || url.password) {
    throw new SsrfBlockedError('URLs with embedded credentials are not allowed', 'credentials_in_url')
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')

  if (hostname.length === 0) {
    throw new SsrfBlockedError('empty hostname', 'empty_hostname')
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfBlockedError(`hostname ${hostname} is blocked`, 'blocked_hostname')
  }

  if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new SsrfBlockedError(`hostname ${hostname} is an internal-network name`, 'internal_hostname')
  }

  if (BLOCKED_SERVICE_NAMES.includes(hostname)) {
    throw new SsrfBlockedError(`hostname ${hostname} is an internal service name`, 'internal_service')
  }

  // A hostname with no dot cannot be a public FQDN — it is a container or
  // /etc/hosts name.
  if (!hostname.includes('.') && isIP(hostname) === 0) {
    throw new SsrfBlockedError(`hostname ${hostname} is not a fully-qualified public name`, 'not_fqdn')
  }

  // A literal IP in the URL is checked directly — DNS is not involved.
  if (isIP(hostname) !== 0) {
    const reason = blockedIpReason(hostname)
    if (reason) {
      throw new SsrfBlockedError(`address ${hostname} is not publicly routable (${reason})`, reason)
    }
    return { url, resolvedAddresses: [hostname] }
  }

  let addresses: { address: string }[]
  try {
    addresses = await resolver(hostname, { all: true })
  } catch (error) {
    throw new SsrfBlockedError(
      `DNS resolution failed for ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
      'dns_failure',
    )
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`${hostname} resolved to no addresses`, 'dns_empty')
  }

  // EVERY address must be public. If a name resolves to both a public and
  // a private address, we refuse — the fetch could pick either.
  for (const { address } of addresses) {
    const reason = blockedIpReason(address)
    if (reason) {
      throw new SsrfBlockedError(`${hostname} resolves to non-public address ${address} (${reason})`, reason)
    }
  }

  return { url, resolvedAddresses: addresses.map((a) => a.address) }
}
