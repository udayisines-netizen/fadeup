import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { pollingInterval, useRealtimeInvalidation } from '@/lib/realtime'
import { getSupabaseClient } from '@/lib/supabase'
import { bookingErrorKey } from '@/lib/queries/booking-requests'

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }))

const mockGetSupabaseClient = vi.mocked(getSupabaseClient)

/** A fake channel that records what was subscribed to and can fire events. */
function fakeSupabase() {
  const handlers: Array<{ config: Record<string, unknown>; callback: () => void }> = []
  let statusCallback: ((status: string) => void) | undefined
  const removeChannel = vi.fn()
  const channelNames: string[] = []

  const channel = {
    on: vi.fn((_event: string, config: Record<string, unknown>, callback: () => void) => {
      handlers.push({ config, callback })
      return channel
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      statusCallback = callback
      return channel
    }),
  }

  return {
    client: {
      channel: vi.fn((name: string) => {
        channelNames.push(name)
        return channel
      }),
      removeChannel,
    },
    handlers,
    channelNames,
    removeChannel,
    emit: () => handlers.forEach((handler) => handler.callback()),
    setStatus: (status: string) => statusCallback?.(status),
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

    expect(fake.channelNames).toEqual(['booking-requests-org-1'])
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
