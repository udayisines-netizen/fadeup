/**
 * WhatsApp provider abstraction.
 *
 * Two implementations, and only two are permitted to exist:
 *   - CloudApiProvider — the official Meta WhatsApp Business Platform
 *     (Cloud API), graph.facebook.com.
 *   - MockProvider     — an in-process stub that sends nothing.
 *
 * There is deliberately NO browser-automation path, no WhatsApp Web
 * driver, and no reverse-engineered client (spec §27). If Meta
 * credentials are absent, the mock runs and the pipeline stays fully
 * exercisable — it never falls back to an unofficial transport.
 */

export interface SendTemplateMessageInput {
  toPhoneE164: string
  /** The Meta-approved template name, as registered in the template manager. */
  metaTemplateName: string
  /** Meta's language code for that template, e.g. 'fr' or 'en_GB'. */
  metaTemplateLanguage: string
  /** Positional body parameters, in the order Meta's {{1}}..{{n}} expect. */
  bodyParameters: string[]
  /**
   * Our idempotency key. Sent to Meta as the message's biz_opaque_callback_data
   * so a redelivered webhook can be correlated, and stored locally under a
   * UNIQUE index so a retry cannot double-send.
   */
  idempotencyKey: string
}

export interface SendResult {
  /** Meta's wamid. For the mock, a clearly-synthetic identifier. */
  providerMessageId: string
  /** True when nothing left this process. Always true for the mock. */
  simulated: boolean
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    /** True when the destination is permanently unusable and must be suppressed rather than retried. */
    public readonly permanent: boolean,
  ) {
    super(message)
    this.name = 'WhatsAppSendError'
  }
}

export interface WhatsAppProvider {
  readonly mode: 'mock' | 'live'
  sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendResult>
  healthCheck(): Promise<{ healthy: boolean; detail: string }>
}

/**
 * Meta error codes that mean "this destination will never work". Retrying
 * these burns quota and, worse, keeps a dead number in the campaign.
 * Sourced from Meta's Cloud API error reference.
 */
const PERMANENT_ERROR_CODES = new Set([
  '131026', // Message undeliverable — recipient not on WhatsApp.
  '131047', // Re-engagement message required (outside the 24h window without a template).
  '131051', // Unsupported message type.
  '132000', // Template param count mismatch — a config error, not transient.
  '132001', // Template does not exist / not approved in this language.
  '132005', // Template hydrated text too long.
  '132007', // Template format character policy violated.
  '133010', // Phone number not registered.
])

export class CloudApiProvider implements WhatsAppProvider {
  readonly mode = 'live' as const

  constructor(
    private readonly config: {
      phoneNumberId: string
      accessToken: string
      graphApiVersion: string
      timeoutMs: number
    },
  ) {}

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.config.graphApiVersion}/${encodeURIComponent(this.config.phoneNumberId)}/messages`

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      // Meta expects the number without a leading '+'.
      to: input.toPhoneE164.replace(/^\+/, ''),
      type: 'template',
      // Echoed back on status webhooks, which is how a delivery receipt is
      // correlated to our own send record.
      biz_opaque_callback_data: input.idempotencyKey,
      template: {
        name: input.metaTemplateName,
        language: { code: input.metaTemplateLanguage },
        components:
          input.bodyParameters.length > 0
            ? [
                {
                  type: 'body',
                  parameters: input.bodyParameters.map((text) => ({ type: 'text', text })),
                },
              ]
            : [],
      },
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          // The token is a header, never a query parameter — a query
          // parameter would end up in provider access logs.
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'
      // Note the deliberate absence of the URL/token in this message: it
      // is persisted to whatsapp_messages.error_message, which platform
      // support staff can read.
      throw new WhatsAppSendError(
        aborted ? 'WhatsApp Cloud API request timed out' : 'WhatsApp Cloud API request failed',
        aborted ? 'timeout' : 'network_error',
        false,
      )
    } finally {
      clearTimeout(timeout)
    }

    const text = await response.text()
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new WhatsAppSendError(`WhatsApp Cloud API returned non-JSON (HTTP ${response.status})`, 'invalid_response', false)
    }

    if (!response.ok) {
      const error = (body['error'] ?? {}) as Record<string, unknown>
      const code = String(error['code'] ?? response.status)
      const message = String(error['message'] ?? `HTTP ${response.status}`)
      throw new WhatsAppSendError(`WhatsApp send rejected: ${message}`, code, PERMANENT_ERROR_CODES.has(code))
    }

    const messages = body['messages']
    const providerMessageId =
      Array.isArray(messages) && messages[0] && typeof messages[0] === 'object'
        ? String((messages[0] as Record<string, unknown>)['id'] ?? '')
        : ''

    if (!providerMessageId) {
      throw new WhatsAppSendError('WhatsApp Cloud API accepted the request but returned no message id', 'no_message_id', false)
    }

    return { providerMessageId, simulated: false }
  }

  async healthCheck(): Promise<{ healthy: boolean; detail: string }> {
    // Reads the phone number's own metadata — the cheapest authenticated
    // call that proves the token and phone number id are both valid.
    const url = `https://graph.facebook.com/${this.config.graphApiVersion}/${encodeURIComponent(this.config.phoneNumberId)}?fields=verified_name,quality_rating`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)

    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${this.config.accessToken}` },
        signal: controller.signal,
      })
      if (!response.ok) {
        return { healthy: false, detail: `Cloud API returned HTTP ${response.status}` }
      }
      const body = (await response.json()) as Record<string, unknown>
      return { healthy: true, detail: `verified_name=${String(body['verified_name'] ?? 'unknown')}, quality=${String(body['quality_rating'] ?? 'unknown')}` }
    } catch (error) {
      return { healthy: false, detail: error instanceof Error ? error.name : 'unknown_error' }
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * The mock provider.
 *
 * Records what WOULD have been sent and returns a synthetic message id
 * prefixed `wamid.MOCK.` so a mocked message can never be mistaken for a
 * real one in the database, in analytics, or in a report. Nothing touches
 * the network.
 */
export class MockProvider implements WhatsAppProvider {
  readonly mode = 'mock' as const

  /** Every simulated send, in order. Tests and the benchmark tool read this. */
  readonly sent: SendTemplateMessageInput[] = []

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<SendResult> {
    this.sent.push(input)
    return {
      providerMessageId: `wamid.MOCK.${input.idempotencyKey}`,
      simulated: true,
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; detail: string }> {
    return { healthy: true, detail: 'mock provider — no Meta credentials required, no messages leave this process' }
  }
}
