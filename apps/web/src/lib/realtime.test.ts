import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { pollingInterval, useRealtimeInvalidation } from '@/lib/realtime'
import { getSupabaseClient } from '@/lib/supabase'
import { bookingErrorKey } from '@/lib/queries/booking-requests'

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }))

const mockGetSupabaseClient = vi.mocked(getSupabaseClient)

interface FakeChannel {
  topic: string
  handlers: Array<{ config: Record<string, unknown>; callback: () => void }>
  subscribed: boolean
  on: (type: string, config: Record<string, unknown>, callback: () => void) => FakeChannel
  subscribe: (callback: (status: string) => void) => FakeChannel
  /** Fire a postgres_changes event on THIS channel only. */
  emit: () => void
  /** Deliver a subscribe-status callback to THIS channel only. */
  setStatus: (status: string) => void
}

/**
 * A fake that reproduces the two supabase-js behaviours this helper has to
 * survive, rather than a convenient stub that hides them:
 *
 *  1. `RealtimeClient.channel(topic)` RETURNS THE EXISTING CHANNEL when one
 *     with that topic is still registered — it does not create a second one.
 *  2. `RealtimeChannel.on('postgres_changes', …)` THROWS once the channel has
 *     joined.
 *  3. `removeChannel()` is async: it awaits the server's leave acknowledgement,
 *     so the channel stays registered until that settles. Tests settle it
 *     explicitly with `settleRemovals()`; leaving it pending models the exact
 *     window a fast tenant switch lands in.
 *
 * Together these are what turned a topic collision into a thrown
 * "cannot add postgres_changes callbacks after subscribe()" that took the
 * render down with it.
 */
function fakeSupabase() {
  const registry = new Map<string, FakeChannel>()
  const created: FakeChannel[] = []
  const pendingRemovals: FakeChannel[] = []

  function makeChannel(topic: string): FakeChannel {
    let statusCallback: ((status: string) => void) | undefined

    const fake: FakeChannel = {
      topic,
      handlers: [],
      subscribed: false,
      on: vi.fn((_type: string, config: Record<string, unknown>, callback: () => void) => {
        if (fake.subscribed) {
          throw new Error(
            `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`,
          )
        }
        fake.handlers.push({ config, callback })
        return fake
      }),
      subscribe: vi.fn((callback: (status: string) => void) => {
        fake.subscribed = true
        statusCallback = callback
        return fake
      }),
      emit: () => fake.handlers.forEach((handler) => handler.callback()),
      setStatus: (status: string) => statusCallback?.(status),
    }

    return fake
  }

  const channel = vi.fn((topic: string) => {
    const existing = registry.get(topic)
    if (existing) return existing

    const fake = makeChannel(topic)
    registry.set(topic, fake)
    created.push(fake)
    return fake
  })

  const removeChannel = vi.fn(async (target: FakeChannel) => {
    pendingRemovals.push(target)
    return 'ok'
  })

  return {
    client: { channel, removeChannel },
    removeChannel,
    /** Every channel ever opened, in creation order. */
    created,
    /** The physical topics that actually reached the socket. */
    topics: () => created.map((entry) => entry.topic),
    /** Let the in-flight `removeChannel()` calls finish. */
    settleRemovals: () => {
      while (pendingRemovals.length > 0) registry.delete(pendingRemovals.pop()!.topic)
    },
    get handlers() {
      return created.flatMap((entry) => entry.handlers)
    },
    emit: () => created.forEach((entry) => entry.emit()),
    setStatus: (status: string) => created.forEach((entry) => entry.setStatus(status)),
  }
}

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useRealtimeInvalidation', () => {
  let fake: ReturnType<typeof fakeSupabase>
  let queryClient: QueryClient

  beforeEach(() => {
    fake = fakeSupabase()
    mockGetSupabaseClient.mockReturnValue(fake.client as never)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('scopes the subscription with a filter so a tenant only receives its own traffic', () => {
    renderHook(
      () =>
        useRealtimeInvalidation(
          'booking-requests-org-1',
          [{ table: 'appointments', filter: 'organization_id=eq.org-1' }],
          [['booking-requests', 'org-1']],
        ),
      { wrapper: wrapper(queryClient) },
    )

    expect(fake.topics()).toHaveLength(1)
    expect(fake.topics()[0]).toMatch(/^booking-requests-org-1#g\d+$/)
    expect(fake.handlers[0].config).toMatchObject({
      schema: 'public',
      table: 'appointments',
      filter: 'organization_id=eq.org-1',
    })
  })

  it('invalidates rather than trusting the payload', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(
      () => useRealtimeInvalidation('c1', [{ table: 'appointments' }], [['booking-requests', 'org-1']]),
      { wrapper: wrapper(queryClient) },
    )

    invalidate.mockClear()
    fake.emit()

    // The event carries a row, and the hook deliberately ignores it: the
    // authoritative read is an RPC that applies authorization the payload
    // has not been through.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['booking-requests', 'org-1'] }),
    )
  })

  it('refetches once on connect, so a reconnect closes the gap it missed', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useRealtimeInvalidation('c1', [{ table: 'appointments' }], [['k']]), {
      wrapper: wrapper(queryClient),
    })

    invalidate.mockClear()
    fake.setStatus('SUBSCRIBED')

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['k'] }))
  })

  it('reports its real connection state instead of pretending to be live', async () => {
    const { result } = renderHook(
      () => useRealtimeInvalidation('c1', [{ table: 'appointments' }], [['k']]),
      { wrapper: wrapper(queryClient) },
    )

    expect(result.current).toBe('connecting')

    fake.setStatus('SUBSCRIBED')
    await waitFor(() => expect(result.current).toBe('live'))

    fake.setStatus('CHANNEL_ERROR')
    await waitFor(() => expect(result.current).toBe('offline'))
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(
      () => useRealtimeInvalidation('c1', [{ table: 'appointments' }], [['k']]),
      { wrapper: wrapper(queryClient) },
    )

    unmount()

    expect(fake.removeChannel).toHaveBeenCalled()
  })

  it('does not subscribe at all without a channel name', () => {
    const { result } = renderHook(
      () => useRealtimeInvalidation(null, [{ table: 'appointments' }], [['k']]),
      { wrapper: wrapper(queryClient) },
    )

    // No signed-in user, no organization: opening a channel would be an
    // unscoped subscription, which is exactly what must not happen.
    expect(fake.client.channel).not.toHaveBeenCalled()
    expect(result.current).toBe('offline')
  })

  it('does not tear the channel down when the caller merely re-renders', () => {
    const { rerender } = renderHook(
      // New array identities every render — the common mistake this guards.
      () => useRealtimeInvalidation('c1', [{ table: 'appointments' }], [['k']]),
      { wrapper: wrapper(queryClient) },
    )

    rerender()
    rerender()

    expect(fake.client.channel).toHaveBeenCalledTimes(1)
  })
})

/**
 * The tenant-transition regressions.
 *
 * None of this changes who may read what — that is RLS, in the database, and
 * these tests assert the `organization_id=eq.` filter survives precisely
 * because it must keep narrowing traffic, not because it authorizes anything.
 * What they do pin down is lifecycle: which physical channel exists when, and
 * whose query keys a channel is still allowed to touch after its generation
 * has been torn down.
 */
describe('useRealtimeInvalidation across a tenant transition', () => {
  let fake: ReturnType<typeof fakeSupabase>
  let queryClient: QueryClient

  beforeEach(() => {
    fake = fakeSupabase()
    mockGetSupabaseClient.mockReturnValue(fake.client as never)
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  /** The real booking-requests call shape, for one organization. */
  function renderForOrg(organizationId: string | null) {
    return renderHook(
      ({ orgId }: { orgId: string | null }) =>
        useRealtimeInvalidation(
          orgId ? `booking-requests-${orgId}` : null,
          [{ table: 'appointments', filter: orgId ? `organization_id=eq.${orgId}` : undefined }],
          [['booking-requests', orgId]],
        ),
      { wrapper: wrapper(queryClient), initialProps: { orgId: organizationId } },
    )
  }

  it('opens a distinct physical channel for org A and for org B', () => {
    const { rerender } = renderForOrg('org-A')
    rerender({ orgId: 'org-B' })

    const [topicA, topicB] = fake.topics()

    expect(fake.created).toHaveLength(2)
    expect(topicA).not.toBe(topicB)
    expect(topicA).toContain('org-A')
    expect(topicB).toContain('org-B')
  })

  it('gives every mount a unique physical topic even for the same logical name', () => {
    // Same logical channel three times over. The topic that reaches the socket
    // must differ every time, or supabase-js hands back the previous, already
    // subscribed channel.
    renderForOrg('org-A').unmount()
    renderForOrg('org-A').unmount()
    renderForOrg('org-A')

    const topics = fake.topics()

    expect(topics).toHaveLength(3)
    expect(new Set(topics).size).toBe(3)
    expect(topics.every((topic) => topic.startsWith('booking-requests-org-A#'))).toBe(true)
  })

  it('keeps each tenant subscription scoped to its own organization_id filter', () => {
    const { rerender } = renderForOrg('org-A')
    rerender({ orgId: 'org-B' })

    const [channelA, channelB] = fake.created

    expect(channelA.handlers).toHaveLength(1)
    expect(channelA.handlers[0].config).toMatchObject({
      schema: 'public',
      table: 'appointments',
      filter: 'organization_id=eq.org-A',
    })

    expect(channelB.handlers).toHaveLength(1)
    expect(channelB.handlers[0].config).toMatchObject({
      schema: 'public',
      table: 'appointments',
      filter: 'organization_id=eq.org-B',
    })
  })

  it('ignores an org A event entirely once org A has been torn down', async () => {
    const { rerender } = renderForOrg('org-A')
    rerender({ orgId: 'org-B' })

    const [channelA] = fake.created
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    invalidate.mockClear()

    // The socket has not finished leaving org A, so its handlers still exist
    // and the server can still deliver. Cleanup has run, so this must be inert:
    // not org B's keys, and not org A's either.
    channelA.emit()
    channelA.setStatus('SUBSCRIBED')

    await waitFor(() => expect(fake.created).toHaveLength(2))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('does not let a stale org A status callback report the new channel as live', async () => {
    const { result, rerender } = renderForOrg('org-A')

    fake.created[0].setStatus('SUBSCRIBED')
    await waitFor(() => expect(result.current).toBe('live'))

    rerender({ orgId: 'org-B' })

    // Org B has not connected yet. Org A saying SUBSCRIBED — or CLOSED, which
    // supabase-js emits as a direct result of our own unsubscribe — must not
    // move the status either way.
    expect(result.current).toBe('connecting')
    fake.created[0].setStatus('SUBSCRIBED')
    fake.created[0].setStatus('CLOSED')
    expect(result.current).toBe('connecting')

    fake.created[1].setStatus('SUBSCRIBED')
    await waitFor(() => expect(result.current).toBe('live'))
  })

  it('re-creates org A while the previous removeChannel is still in flight', () => {
    const first = renderForOrg('org-A')
    first.unmount()

    // Deliberately NOT settled: removeChannel awaits a server acknowledgement,
    // so the old channel is still registered under its topic. Re-creating the
    // same logical channel here is what used to throw
    // "cannot add postgres_changes callbacks after subscribe()".
    expect(fake.removeChannel).toHaveBeenCalledTimes(1)

    expect(() => renderForOrg('org-A')).not.toThrow()
    expect(fake.created).toHaveLength(2)
    expect(fake.created[1].handlers[0].config).toMatchObject({
      table: 'appointments',
      filter: 'organization_id=eq.org-A',
    })
  })

  it('survives an A -> B -> A round trip with every removal still pending', () => {
    const { rerender } = renderForOrg('org-A')

    expect(() => {
      rerender({ orgId: 'org-B' })
      rerender({ orgId: 'org-A' })
    }).not.toThrow()

    expect(new Set(fake.topics()).size).toBe(3)
    expect(fake.created[2].handlers[0].config).toMatchObject({
      filter: 'organization_id=eq.org-A',
    })
  })

  it('opens nothing at all while there is no organization', () => {
    const { result, rerender } = renderForOrg(null)

    expect(fake.client.channel).not.toHaveBeenCalled()
    expect(result.current).toBe('offline')

    // And when the org arrives, the very first subscription is already scoped —
    // there is never an unfiltered window.
    rerender({ orgId: 'org-A' })
    expect(fake.created[0].handlers[0].config).toMatchObject({
      table: 'appointments',
      filter: 'organization_id=eq.org-A',
    })
  })

  it('passes the socket a topic and nothing else — no credential, no token', () => {
    renderForOrg('org-A')

    // A channel is opened by topic alone. Anything else here (an access token,
    // a key, a `config` carrying one) would be a privileged credential reaching
    // the browser transport; authorization belongs to RLS and the session JWT
    // the shared client already holds.
    expect(fake.client.channel).toHaveBeenCalledTimes(1)
    expect(fake.client.channel.mock.calls[0]).toHaveLength(1)
    expect(typeof fake.client.channel.mock.calls[0][0]).toBe('string')
  })
})

describe('pollingInterval', () => {
  it('polls slowly while live and quickly while offline', () => {
    // The fallback is what stops a dropped socket turning a live screen into
    // a wrong one.
    expect(pollingInterval('live')).toBeGreaterThan(pollingInterval('offline'))
    expect(pollingInterval('connecting')).toBe(pollingInterval('offline'))
  })
})

describe('bookingErrorKey', () => {
  it('names the normal lifecycle races', () => {
    expect(bookingErrorKey({ message: 'this request has already been answered' })).toBe(
      'requests.errors.alreadyAnswered',
    )
    expect(bookingErrorKey({ message: 'this request has expired' })).toBe('requests.errors.expired')
    expect(bookingErrorKey({ message: 'not authorized to manage this booking' })).toBe(
      'requests.errors.notAuthorized',
    )
  })

  it('recognises a GiST conflict as "someone took that slot"', () => {
    expect(
      bookingErrorKey({ message: 'conflicting key value violates exclusion constraint "appointments_barber_no_overlap"' }),
    ).toBe('requests.errors.slotTaken')
  })

  it('falls back rather than guessing', () => {
    expect(bookingErrorKey({ message: 'connection reset' })).toBe('requests.errors.generic')
    expect(bookingErrorKey(null)).toBe('requests.errors.generic')
  })
})
