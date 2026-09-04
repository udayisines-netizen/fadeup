import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OTPInput } from '@/shared/ui/OTPInput'

function Harness({ onComplete }: { onComplete?: (value: string) => void }) {
  const [value, setValue] = useState('')
  return <OTPInput label="Code" value={value} onValueChange={setValue} onComplete={onComplete} />
}

describe('OTPInput', () => {
  it('affiche six cases avec autocomplete one-time-code sur la première', () => {
    render(<Harness />)
    const boxes = screen.getAllByRole('textbox')
    expect(boxes).toHaveLength(6)
    expect(boxes[0]).toHaveAttribute('autocomplete', 'one-time-code')
  })

  it('un collage remplit les six cases et déclenche onComplete', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const first = screen.getAllByRole('textbox')[0]
    expect(first).toBeDefined()
    if (!first) return
    await user.click(first)
    await user.paste('123456')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('ignore les caractères non numériques', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    const first = screen.getAllByRole('textbox')[0]
    if (!first) return
    await user.click(first)
    await user.paste('12ab34cd56')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })
})
