import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RealtimeProvider } from '@/shared/realtime/RealtimeProvider'
import { useChannel } from '@/shared/realtime/useChannel'

interface FakeChannel {
  topic: string
  on: () => FakeChannel
  subscribe: (cb: (status: string) => void) => FakeChannel
}

const created: FakeChannel[] = []
const removeChannel = vi.fn()

vi.mock('@/shared/lib/supabase', () => ({
  getSupabase: () => ({
    channel: (topic: string) => {
      const channel: FakeChannel = {
        topic,
        on: () => channel,
        subscribe: (cb) => {
          cb('SUBSCRIBED')
          return channel
        },
      }
      created.push(channel)
      return channel
    },
    removeChannel,
  }),
}))

function Subscriber() {
  useChannel({
    name: 'notifications:test',
    table: 'notifications',
    filter: 'user_id=eq.test',
    onInsert: () => undefined,
  })
  return null
}

describe('useChannel', () => {
  it('crée un canal au montage et le LIBÈRE au démontage — aucun canal orphelin', () => {
    const { unmount } = render(
      <RealtimeProvider>
        <Subscriber />
      </RealtimeProvider>,
    )
    expect(created.length).toBeGreaterThan(0)
    const mine = created[created.length - 1]
    unmount()
    expect(removeChannel).toHaveBeenCalledWith(mine)
  })
})
