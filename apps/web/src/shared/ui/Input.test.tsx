import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Input } from '@/shared/ui/Input'

describe('Input', () => {
  it('le label est obligatoire et VISIBLE, relié au champ', () => {
    render(<Input label="Adresse e-mail" />)
    const input = screen.getByLabelText('Adresse e-mail')
    expect(input).toBeVisible()
    expect(screen.getByText('Adresse e-mail')).toBeVisible()
  })

  it('error remplace hint et pose aria-invalid + aria-describedby', () => {
    render(<Input label="E-mail" hint="Un indice" error="Adresse invalide" />)
    const input = screen.getByLabelText('E-mail')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Adresse invalide')).toBeInTheDocument()
    expect(screen.queryByText('Un indice')).toBeNull()
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent('Adresse invalide')
  })

  it('hint visible sans erreur', () => {
    render(<Input label="E-mail" hint="Un indice" />)
    expect(screen.getByText('Un indice')).toBeInTheDocument()
  })
})
