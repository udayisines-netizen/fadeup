/**
 * Template rendering.
 *
 * CRITICAL (spec §23/§24): this is pure, whitelisted variable
 * substitution. There is no expression language, no conditionals, no
 * loops, no function calls, no `eval`, no `Function` constructor, and no
 * path into any of those. A template body is administrator-written text
 * with {{placeholder}} tokens, and the ONLY thing this module does is swap
 * a validated value in for a whitelisted token.
 *
 * Nothing in this codebase generates message copy. There is no LLM call
 * anywhere in the outreach path — the Worker has no AI dependency at all.
 */

export class TemplateRenderError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message)
    this.name = 'TemplateRenderError'
  }
}

/**
 * The complete set of variables any template may reference. Adding one is
 * a deliberate code change plus a template's allowed_variables update —
 * there is no way to reach arbitrary prospect data from a template.
 */
export const KNOWN_VARIABLES = ['business_name', 'city', 'competitor', 'shop_type', 'barber_count'] as const
export type KnownVariable = (typeof KNOWN_VARIABLES)[number]

export type TemplateVariables = Partial<Record<KnownVariable, string>>

/** Matches {{ variable_name }} with optional surrounding whitespace. Nothing else is a placeholder. */
const PLACEHOLDER_PATTERN = /\{\{\s*([a-z_][a-z0-9_]{0,40})\s*\}\}/g

/** Hard ceiling matching outreach_templates.body / outreach_recipients.rendered_body. */
const MAX_RENDERED_LENGTH = 4000

/** Per-value ceiling: a business name is a business name, not a payload. */
const MAX_VALUE_LENGTH = 120

export interface RenderInput {
  body: string
  allowedVariables: string[]
  variables: TemplateVariables
}

export interface RenderResult {
  body: string
  /** Exactly the variables that were substituted, for the audit record on outreach_recipients. */
  usedVariables: Record<string, string>
}

/**
 * Renders a template body.
 *
 * Throws rather than degrading: a template that references a variable we
 * cannot fill would go out with a literal "{{city}}" in it, and sending
 * that to a real barber is worse than not sending at all.
 */
export function renderTemplate(input: RenderInput): RenderResult {
  if (input.body.length > MAX_RENDERED_LENGTH) {
    throw new TemplateRenderError('template body exceeds the maximum length', 'body_too_long')
  }

  const allowed = new Set(input.allowedVariables)
  const used: Record<string, string> = {}

  const rendered = input.body.replace(PLACEHOLDER_PATTERN, (_match, rawName: string) => {
    const name = rawName as KnownVariable

    // A placeholder the engine does not know about at all.
    if (!(KNOWN_VARIABLES as readonly string[]).includes(name)) {
      throw new TemplateRenderError(`template references unknown variable "${name}"`, 'unknown_variable')
    }

    // Known, but this template was not authorised to use it.
    if (!allowed.has(name)) {
      throw new TemplateRenderError(`template is not permitted to use variable "${name}"`, 'variable_not_allowed')
    }

    const value = input.variables[name]
    if (value === undefined || value === null || value.trim() === '') {
      throw new TemplateRenderError(`no value available for required variable "${name}"`, 'missing_value')
    }

    const sanitized = sanitizeValue(value)
    used[name] = sanitized
    return sanitized
  })

  if (rendered.length > MAX_RENDERED_LENGTH) {
    throw new TemplateRenderError('rendered message exceeds the maximum length', 'rendered_too_long')
  }

  // A leftover "{{" means something did not substitute — refuse rather
  // than send a message with visible template syntax.
  if (rendered.includes('{{')) {
    throw new TemplateRenderError('rendered message still contains template syntax', 'unresolved_placeholder')
  }

  return { body: rendered, usedVariables: used }
}

/**
 * Validates and normalizes a substituted value.
 *
 * WhatsApp template parameters cannot contain newlines or tabs (Meta
 * rejects them), and a value containing "{{" could otherwise inject a
 * placeholder into the rendered output. Control characters are stripped
 * outright.
 */
export function sanitizeValue(raw: string): string {
  const collapsed = raw
    // Strip C0/C1 control characters, including the newlines and tabs Meta
    // rejects in WhatsApp template parameters.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    // Bidirectional and zero-width formatting characters, which can make a
    // rendered message display differently from the copy that was approved.
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    // Neutralise any attempt to inject template syntax through a value.
    .replace(/\{\{/g, '(')
    .replace(/\}\}/g, ')')
    .replace(/\s+/g, ' ')
    .trim()

  if (collapsed.length === 0) {
    throw new TemplateRenderError('variable value is empty after sanitisation', 'empty_value')
  }

  return collapsed.length <= MAX_VALUE_LENGTH ? collapsed : `${collapsed.slice(0, MAX_VALUE_LENGTH - 1)}…`
}

/** Extracts the placeholders a body uses — used by /platform to preview and by validation on save. */
export function extractPlaceholders(body: string): string[] {
  return [...new Set([...body.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[1] ?? ''))].filter((v) => v.length > 0)
}

/**
 * Validates a template body without rendering it. Returns the problems
 * found so /platform can show them at authoring time rather than at send
 * time.
 */
export function validateTemplateBody(body: string, allowedVariables: string[]): string[] {
  const problems: string[] = []
  const allowed = new Set(allowedVariables)

  if (body.trim().length === 0) problems.push('Body is empty.')
  if (body.length > MAX_RENDERED_LENGTH) problems.push(`Body exceeds ${MAX_RENDERED_LENGTH} characters.`)

  for (const placeholder of extractPlaceholders(body)) {
    if (!(KNOWN_VARIABLES as readonly string[]).includes(placeholder)) {
      problems.push(`Unknown variable "{{${placeholder}}}". Available: ${KNOWN_VARIABLES.join(', ')}.`)
    } else if (!allowed.has(placeholder)) {
      problems.push(`Variable "{{${placeholder}}}" is not in this template's allowed list.`)
    }
  }

  // Catch a malformed placeholder like {{business name}} or {{Business_Name}}
  // that PLACEHOLDER_PATTERN does not match and which would therefore ship
  // literally in the message body.
  //
  // Done by scanning EVERY {{...}} occurrence and flagging any that is not
  // a valid placeholder, rather than trying to write a regex for
  // "malformed" — the set of ways to be malformed is open-ended, but the
  // set of ways to be VALID is exactly one.
  const validPlaceholders = new Set([...body.matchAll(PLACEHOLDER_PATTERN)].map((m) => m[0]))
  const malformed = [...body.matchAll(/\{\{[^{}]{0,60}\}\}/g)]
    .map((m) => m[0])
    .filter((candidate) => !validPlaceholders.has(candidate))

  if (malformed.length > 0) {
    problems.push(`Malformed placeholder(s): ${[...new Set(malformed)].join(', ')}.`)
  }

  return problems
}
