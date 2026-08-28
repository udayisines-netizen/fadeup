import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { FollowControl } from '@/components/ui/follow-control'

function renderControl(overrides: Partial<Parameters<typeof FollowControl>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/s/demo/profile?x=1']}>
      <FollowControl
        signedOut={false}
        isFollowing={false}
        isPending={false}
        onToggle={() => {}}
        followLabel="Follow"
        followingLabel="Following"
        unfollowLabel="Unfollow"
        {...overrides}
      />
    </MemoryRouter>,
  )
}

describe('FollowControl', () => {
  it('always lays out BOTH labels, so the control cannot resize when pressed', () => {
    const { rerender } = renderControl()

    // Not following: "Follow" is announced, "Following" is present but hidden
    // and reserving width.
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()
    expect(screen.getByText('Following')).toHaveClass('invisible')

    rerender(
      <MemoryRouter initialEntries={['/s/demo/profile?x=1']}>
        <FollowControl
          signedOut={false}
          isFollowing
          isPending={false}
          onToggle={() => {}}
          followLabel="Follow"
          followingLabel="Following"
          unfollowLabel="Unfollow"
        />
      </MemoryRouter>,
    )

    // Following: the roles swap, and the same two nodes are still in the DOM.
    expect(screen.getByText('Follow')).toHaveClass('invisible')
    expect(screen.getByText('Following')).not.toHaveClass('invisible')
  })

  it('hides the reserved label from the accessibility tree so it is not read twice', () => {
    renderControl()
    expect(screen.getByText('Following')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Follow')).not.toHaveAttribute('aria-hidden')
  })

  it('announces the ACTION when following, not the state', () => {
    // "Following" as an accessible name tells a screen reader user what is
    // true, not what pressing will do. The pressed state already carries the
    // former via aria-pressed.
    renderControl({ isFollowing: true })
    const button = screen.getByRole('button', { name: 'Unfollow' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends a signed-out visitor to login with a redirect back, never a dead button', () => {
    renderControl({ signedOut: true })
    expect(screen.getByRole('link', { name: 'Follow' })).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent('/s/demo/profile?x=1')}`,
    )
  })

  it('stops accepting input while a follow is in flight', () => {
    const onToggle = vi.fn()
    renderControl({ isPending: true, onToggle })
    expect(screen.getByRole('button', { name: 'Follow' })).toBeDisabled()
  })
})
