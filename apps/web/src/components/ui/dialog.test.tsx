import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Guards the structural contract that made Add Location unusable on a
 * 1366x768 screen. Two separate defects lived here:
 *
 *  1. The content box had no height limit, so a tall form simply extended
 *     past the viewport — and a `fixed` element does not scroll with the
 *     page, so the fields and buttons below the fold could not be reached at
 *     all.
 *  2. `@keyframes fu-content-in` animated `transform: translate(-50%,-50%)`
 *     with `fill-mode: both`, which did not replace the Tailwind
 *     `-translate-x-1/2 -translate-y-1/2` centring (Tailwind v4 emits those
 *     as the separate `translate` property) but composed with it, leaving
 *     every dialog offset by a full -100%/-100%.
 *
 * jsdom does not do layout, so these assert the contract rather than pixels;
 * the real geometry is verified in a browser at 390/768/1366/1440/1920.
 */
function renderDialog(body: React.ReactNode) {
  return render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add location</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>,
  )
}

describe('Dialog — stays inside the viewport', () => {
  it('caps the content box to the viewport height', () => {
    renderDialog(<p>Body</p>)

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/max-h-\[calc\(100dvh-2rem\)\]/)
  })

  it('lays the content out as a column so header and footer can stay put', () => {
    renderDialog(<p>Body</p>)

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('flex')
    expect(dialog.className).toContain('flex-col')
  })

  it('scrolls rather than overflowing when a form is taller than the screen', () => {
    renderDialog(<p>Body</p>)

    expect(screen.getByRole('dialog').className).toContain('overflow-y-auto')
  })

  it('gives DialogBody the shrink + scroll behaviour the footer depends on', () => {
    // The dialog is portalled out of `container`, so query the screen.
    renderDialog(
      <DialogBody data-testid="body">
        <input aria-label="Name" />
      </DialogBody>,
    )

    const body = screen.getByTestId('body')
    // min-h-0 is the part that actually lets it shrink: a flex child defaults
    // to min-height:auto and would push the footer out of the dialog instead.
    expect(body.className).toContain('min-h-0')
    expect(body.className).toContain('flex-1')
    expect(body.className).toContain('overflow-y-auto')
  })

  it('keeps the header and footer from being squeezed by a long body', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader data-testid="header">
            <DialogTitle>Add location</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <input aria-label="Name" />
          </DialogBody>
          <DialogFooter data-testid="footer">
            <button type="submit">Add location</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    expect(screen.getByTestId('header').className).toContain('shrink-0')
    expect(screen.getByTestId('footer').className).toContain('shrink-0')
    // The action stays a sibling of the scroll area, never inside it.
    expect(screen.getByRole('button', { name: 'Add location' })).toBeInTheDocument()
  })
})
