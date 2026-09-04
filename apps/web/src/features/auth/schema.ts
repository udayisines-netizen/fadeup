import { z } from 'zod'

/**
 * Schémas de validation des formulaires d'auth. Les messages sont des CLÉS
 * i18n (namespace v2) résolues à l'affichage — jamais du texte en dur.
 */

export const emailField = z.string().trim().email('auth.validation.emailInvalid')
export const passwordField = z.string().min(8, 'auth.validation.passwordTooShort')

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'auth.validation.passwordTooShort'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const signupSchema = z.object({
  email: emailField,
  password: passwordField,
})
export type SignupValues = z.infer<typeof signupSchema>

export const emailOnlySchema = z.object({
  email: emailField,
})
export type EmailOnlyValues = z.infer<typeof emailOnlySchema>

export const resetSchema = z
  .object({
    password: passwordField,
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    message: 'auth.reset.mismatch',
    path: ['confirm'],
  })
export type ResetValues = z.infer<typeof resetSchema>

export const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'auth.validation.otpLength'),
})
export type OtpValues = z.infer<typeof otpSchema>
