import { describe, expect, it } from 'vitest'
import { assertUrlIsSafe, blockedIpReason, SsrfBlockedError } from '../src/crawler/ssrf.js'

/**
 * SSRF is the highest-severity risk in this worker: the crawler fetches
 * URLs that came from third-party APIs and from page content, i.e.
 * attacker-influenceable input, from inside the Docker network that also
 * hosts Supabase.
 */

/** A stub resolver, so these tests never touch real DNS. */
function resolverReturning(...addresses: string[]) {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}

const resolverThatFails = async () => {
  throw new Error('ENOTFOUND')
}

describe('blockedIpReason', () => {
  it('allows genuinely public IPv4 addresses', () => {
    expect(blockedIpReason('8.8.8.8')).toBeNull()
    expect(blockedIpReason('93.184.216.34')).toBeNull()
    expect(blockedIpReason('1.1.1.1')).toBeNull()
  })

  it('blocks loopback', () => {
    expect(blockedIpReason('127.0.0.1')).toBe('loopback')
    expect(blockedIpReason('127.255.255.254')).toBe('loopback')
  })

  it('blocks every RFC1918 private range', () => {
    expect(blockedIpReason('10.0.0.1')).toBe('rfc1918_private')
    expect(blockedIpReason('172.16.0.1')).toBe('rfc1918_private')
    expect(blockedIpReason('172.31.255.255')).toBe('rfc1918_private')
    expect(blockedIpReason('192.168.1.1')).toBe('rfc1918_private')
  })

  it('does not over-block 172.x addresses outside 172.16/12', () => {
    expect(blockedIpReason('172.15.0.1')).toBeNull()
    expect(blockedIpReason('172.32.0.1')).toBeNull()
  })

  it('blocks the cloud metadata endpoint', () => {
    // The single most valuable SSRF target in any cloud environment.
    expect(blockedIpReason('169.254.169.254')).toBe('link_local_or_metadata')
  })

  it('blocks carrier-grade NAT, multicast and reserved space', () => {
    expect(blockedIpReason('100.64.0.1')).toBe('cgnat_shared')
    expect(blockedIpReason('224.0.0.1')).toBe('multicast')
    expect(blockedIpReason('255.255.255.255')).toBe('reserved')
    expect(blockedIpReason('0.0.0.0')).toBe('this_network')
  })

  it('blocks IPv6 loopback, link-local and unique-local', () => {
    expect(blockedIpReason('::1')).toBe('loopback')
    expect(blockedIpReason('fe80::1')).toBe('link_local')
    expect(blockedIpReason('fd00::1')).toBe('unique_local')
    expect(blockedIpReason('fc00::1')).toBe('unique_local')
  })

  it('blocks IPv4-mapped IPv6 loopback, which a naive v6 check would miss', () => {
    expect(blockedIpReason('::ffff:127.0.0.1')).toBe('loopback')
    expect(blockedIpReason('::ffff:169.254.169.254')).toBe('link_local_or_metadata')
    expect(blockedIpReason('::ffff:10.0.0.1')).toBe('rfc1918_private')
  })

  it('blocks NAT64 and 6to4, which can embed a blocked IPv4 address', () => {
    expect(blockedIpReason('64:ff9b::7f00:1')).toBe('nat64')
    expect(blockedIpReason('2002:7f00:1::')).toBe('6to4')
  })

  it('allows a public IPv6 address', () => {
    expect(blockedIpReason('2606:4700:4700::1111')).toBeNull()
  })
})

describe('assertUrlIsSafe', () => {
  it('accepts a normal public https URL', async () => {
    const result = await assertUrlIsSafe('https://example.com/contact', resolverReturning('93.184.216.34'))
    expect(result.url.hostname).toBe('example.com')
    expect(result.resolvedAddresses).toEqual(['93.184.216.34'])
  })

  it('rejects non-http protocols', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com', 'ftp://example.com']) {
      await expect(assertUrlIsSafe(url, resolverReturning('93.184.216.34'))).rejects.toThrow(SsrfBlockedError)
    }
  })

  it('rejects non-standard ports', async () => {
    await expect(assertUrlIsSafe('http://example.com:6379/', resolverReturning('93.184.216.34'))).rejects.toThrow(
      /port 6379 is not allowed/,
    )
    await expect(assertUrlIsSafe('http://example.com:22/', resolverReturning('93.184.216.34'))).rejects.toThrow(
      /port 22 is not allowed/,
    )
  })

  it('rejects embedded credentials', async () => {
    await expect(
      assertUrlIsSafe('https://user:pass@example.com/', resolverReturning('93.184.216.34')),
    ).rejects.toThrow(/credentials/)
  })

  it('rejects localhost and internal hostnames by name', async () => {
    for (const url of [
      'http://localhost/',
      'http://metadata.google.internal/',
      'http://foo.internal/',
      'http://svc.cluster.local/',
    ]) {
      await expect(assertUrlIsSafe(url, resolverReturning('93.184.216.34'))).rejects.toThrow(SsrfBlockedError)
    }
  })

  it('rejects the FadeUp stack’s own service names', async () => {
    // The crawler shares a Docker network with Supabase; a hostile
    // "website" value must not be able to reach it.
    await expect(assertUrlIsSafe('http://fadeup-supabase-db/', resolverReturning('10.0.0.5'))).rejects.toThrow(
      /internal service name/,
    )
    await expect(assertUrlIsSafe('http://kong/', resolverReturning('10.0.0.6'))).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects a bare hostname with no dot', async () => {
    await expect(assertUrlIsSafe('http://intranet/', resolverReturning('10.1.2.3'))).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects a literal private IP in the URL without consulting DNS', async () => {
    await expect(assertUrlIsSafe('http://169.254.169.254/latest/meta-data/', resolverThatFails)).rejects.toThrow(
      /not publicly routable/,
    )
    await expect(assertUrlIsSafe('http://127.0.0.1:8080/', resolverThatFails)).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects a PUBLIC hostname that resolves to a private address', async () => {
    // This is the attack the hostname allowlist alone cannot stop: an
    // attacker-controlled domain with an A record pointing at 127.0.0.1.
    await expect(assertUrlIsSafe('https://evil.example.com/', resolverReturning('127.0.0.1'))).rejects.toThrow(
      /resolves to non-public address/,
    )
  })

  it('rejects when ANY resolved address is private, even if another is public', async () => {
    // fetch() may pick either address, so a mixed result must be refused.
    await expect(
      assertUrlIsSafe('https://mixed.example.com/', resolverReturning('93.184.216.34', '10.0.0.1')),
    ).rejects.toThrow(/resolves to non-public address/)
  })

  it('rejects when DNS fails or returns nothing', async () => {
    await expect(assertUrlIsSafe('https://nowhere.example.com/', resolverThatFails)).rejects.toThrow(/DNS resolution failed/)
    await expect(assertUrlIsSafe('https://empty.example.com/', async () => [])).rejects.toThrow(/no addresses/)
  })

  it('rejects a malformed URL', async () => {
    await expect(assertUrlIsSafe('not a url', resolverReturning('93.184.216.34'))).rejects.toThrow(/valid absolute URL/)
  })

  it('does not treat a lookalike domain as an internal name', async () => {
    // "notlocalhost.com" must not match the "localhost" blocklist.
    const result = await assertUrlIsSafe('https://notlocalhost.com/', resolverReturning('93.184.216.34'))
    expect(result.url.hostname).toBe('notlocalhost.com')
  })
})
