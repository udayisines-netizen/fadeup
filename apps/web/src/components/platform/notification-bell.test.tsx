import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationBell } from '@/components/platform/notification-bell'
import { useAuth } from '@/lib/auth-context'
import {
  usePlatformNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/lib/queries/professional-applications'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/queries/professional-applications', () => ({
  usePlatformNotifications: vi.fn(),
  useMarkNotificationRead: vi.fn(),
  useMarkAllNotificationsRead: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseNotifications = vi.mocked(usePlatformNotifications)
const mockUseMarkRead = vi.mocked(useMarkNotificationRead)
const mockUseMarkAllRead = vi.mocked(useMarkAllNotificationsRead)

const markRead = vi.fn()
const markAllRead = vi.fn()

const UNREAD = {
  id: 'n-1',
  type: 'professional_application_submitted',
  title: 'Fade City',
  body: 'Karim Benali · Lyon',
  targetType: 'professional_applications',
  targetId: 'app-1',
  readAt: null,
  createdAt: '2026-08-13T09:00:00.000Z',
}

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  )
}

describe('NotificationBell — platform owner is told about new applications', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    markRead.mockClear()
    markAllRead.mockClear()
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'platform-1' } as never, loading: false })
    mockUseNotifications.mockReturnValue({ data: [], isPending: false, isError: false } as never)
    mockUseMarkRead.mockReturnValue({ mutate: markRead } as never)
    mockUseMarkAllRead.mockReturnValue({ mutate: markAllRead } as never)
  })

  it('shows the unread count and announces it to assistive tech', () => {
    mockUseNotifications.mockReturnValue({
      data: [UNREAD, { ...UNREAD, id: 'n-2', title: 'Studio Nord' }],
      isPending: false,
      isError: false,
    } as never)

    renderBell()

    expect(screen.getByRole('button', { name: 'Notifications (2)' })).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('carries no badge when everything has been read', () => {
    mockUseNotifications.mockReturnValue({
      data: [{ ...UNREAD, readAt: '2026-08-13T10:00:00.000Z' }],
      isPending: false,
      isError: false,
    } as never)

    renderBell()

    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('opens the matching application and marks it read in one tap', () => {
    mockUseNotifications.mockReturnValue({ data: [UNREAD], isPending: false, isError: false } as never)

    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications (1)' }))

    expect(screen.getByText('New professional application')).toBeInTheDocument()
    expect(screen.getByText('Karim Benali · Lyon')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Fade City'))

    expect(markRead).toHaveBeenCalledWith('n-1')
    expect(mockNavigate).toHaveBeenCalledWith('/platform/applications/app-1')
  })

  it('does not re-mark something that was already read', () => {
    mockUseNotifications.mockReturnValue({
      data: [{ ...UNREAD, readAt: '2026-08-13T10:00:00.000Z' }],
      isPending: false,
      isError: false,
    } as never)

    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    fireEvent.click(screen.getByText('Fade City'))

    expect(markRead).not.toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/platform/applications/app-1')
  })

  it('can clear the whole queue at once', () => {
    mockUseNotifications.mockReturnValue({ data: [UNREAD], isPending: false, isError: false } as never)

    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }))

    expect(markAllRead).toHaveBeenCalledTimes(1)
  })

  it('says nothing is new rather than showing an empty box', () => {
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(screen.getByText('Nothing new')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
  })
})
