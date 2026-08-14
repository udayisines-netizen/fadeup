import { createServer, type Server, type Socket } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { EmailDispatcher } from '../src/email/dispatcher.js'
import type { DbPool } from '../src/db.js'
import type { Config } from '../src/config.js'

/**
 * Proves an approval/rejection email actually leaves the process — not just
 * that a row was queued.
 *
 * A ~40-line SMTP responder stands in for the relay: nodemailer speaks to it
 * for real, so this covers transport construction, the From header, address
 * routing and the rendered body. The database side is a stub, because
 * db/tests/verify_professional_applications.sql and the live lifecycle run
 * already cover enqueueing.
 */

interface CapturedMessage {
  from: string
  to: string[]
  data: string
}

/** Minimal SMTP sink: enough of RFC 5321 for nodemailer to complete a session. */
function startSmtpSink(): Promise<{ server: Server; port: number; messages: CapturedMessage[] }> {
  const messages: CapturedMessage[] = []

  const server = createServer((socket: Socket) => {
    let inData = false
    let current: CapturedMessage = { from: '', to: [], data: '' }

    socket.write('220 localhost ESMTP test sink\r\n')
    socket.setEncoding('utf8')

    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk

      while (buffer.length > 0) {
        if (inData) {
          const terminator = buffer.indexOf('\r\n.\r\n')
          if (terminator === -1) return
          current.data += buffer.slice(0, terminator)
          buffer = buffer.slice(terminator + 5)
          inData = false
          messages.push(current)
          current = { from: '', to: [], data: '' }
          socket.write('250 OK queued\r\n')
          continue
        }

        const lineEnd = buffer.indexOf('\r\n')
        if (lineEnd === -1) return
        const line = buffer.slice(0, lineEnd)
        buffer = buffer.slice(lineEnd + 2)
        const command = line.toUpperCase()

        if (command.startsWith('EHLO') || command.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 SMTPUTF8\r\n')
        } else if (command.startsWith('MAIL FROM')) {
          current.from = line.slice(line.indexOf('<') + 1, line.lastIndexOf('>'))
          socket.write('250 OK\r\n')
        } else if (command.startsWith('RCPT TO')) {
          current.to.push(line.slice(line.indexOf('<') + 1, line.lastIndexOf('>')))
          socket.write('250 OK\r\n')
        } else if (command.startsWith('DATA')) {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (command.startsWith('QUIT')) {
          socket.write('221 Bye\r\n')
          socket.end()
        } else {
          socket.write('250 OK\r\n')
        }
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port, messages })
    })
  })
}

let sink: Awaited<ReturnType<typeof startSmtpSink>>

beforeAll(async () => {
  sink = await startSmtpSink()
})

afterAll(async () => {
  await new Promise<void>((resolve) => sink.server.close(() => resolve()))
})

/**
 * Undoes quoted-printable soft line breaks and hex escapes so assertions can
 * be written against what the recipient reads rather than how it was framed
 * on the wire — a URL is routinely split mid-string by the 76-column rule.
 */
function decodeQuotedPrintable(raw: string): string {
  const unfolded = raw.replace(/=\r?\n/g, '')
  // Decode through bytes, not code units: an accented character arrives as a
  // pair of =XX escapes that only becomes one glyph after UTF-8 decoding.
  const bytes: number[] = []
  for (let index = 0; index < unfolded.length; index += 1) {
    if (unfolded[index] === '=' && /^[0-9A-F]{2}$/.test(unfolded.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(unfolded.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(unfolded.charCodeAt(index))
    }
  }
  return new TextDecoder('utf-8').decode(Uint8Array.from(bytes))
}

function makeConfig(): Config {
  return {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: sink.port,
    SMTP_USER: '',
    SMTP_PASS: '',
    EMAIL_FROM_NAME: 'FadeUp',
    EMAIL_FROM_ADDRESS: 'no-reply@fadeup.test',
    EMAIL_POLL_INTERVAL_MS: 60_000,
    EMAIL_BATCH_SIZE: 10,
    EMAIL_MAX_ATTEMPTS: 5,
    APP_BASE_URL: 'https://fadeup.test',
  } as unknown as Config
}

/** Stubs the two queue calls the dispatcher makes; records which ran. */
function makePool(rows: unknown[]) {
  const calls: string[] = []
  const pool = {
    query: vi.fn(async (text: string) => {
      calls.push(text)
      if (text.includes('claim_next_email')) return { rows }
      return { rows: [] }
    }),
  } as unknown as DbPool
  return { pool, calls }
}

describe('EmailDispatcher — an approved applicant actually receives mail', () => {
  it('renders a claimed row and delivers it over SMTP, then marks it sent', async () => {
    const { pool, calls } = makePool([
      {
        id: 'outbox-1',
        to_email: 'karim@fadecity.fr',
        template: 'professional_application_approved',
        locale: 'fr',
        payload: { first_name: 'Karim', business_name: 'Fade City' },
        attempts: 0,
      },
    ])

    const dispatcher = new EmailDispatcher(pool, makeConfig())
    expect(dispatcher.enabled).toBe(true)

    await dispatcher.drain()
    await dispatcher.stop()

    expect(sink.messages).toHaveLength(1)
    const message = sink.messages[0]!
    expect(message.from).toBe('no-reply@fadeup.test')
    expect(message.to).toEqual(['karim@fadecity.fr'])
    const body = decodeQuotedPrintable(message.data)
    expect(body).toContain('Bonjour Karim,')
    expect(body).toContain('Fade City')
    expect(body).toContain('votre demande a été approuvée')
    // The CTA is an ordinary link, never a token or a magic link.
    expect(body).toContain('https://fadeup.test/pro/login')
    expect(body).not.toMatch(/token|access_token|magic|utm_|<img/i)

    expect(calls.some((call) => call.includes('mark_email_sent'))).toBe(true)
    expect(calls.some((call) => call.includes('mark_email_failed'))).toBe(false)
  })

  it('parks a failure as failed instead of losing it, when the relay is unreachable', async () => {
    const { pool, calls } = makePool([
      {
        id: 'outbox-2',
        to_email: 'sam@studionord.fr',
        template: 'professional_application_rejected',
        locale: 'fr',
        payload: { first_name: 'Sam', rejection_reason: 'Adresse non confirmée.' },
        attempts: 1,
      },
    ])

    const config = makeConfig()
    // Port 1 is reserved and refuses connections.
    const dispatcher = new EmailDispatcher(pool, { ...config, SMTP_PORT: 1 } as Config)

    await dispatcher.drain()
    await dispatcher.stop()

    expect(calls.some((call) => call.includes('mark_email_failed'))).toBe(true)
    expect(calls.some((call) => call.includes('mark_email_sent'))).toBe(false)
  })

  it('stays switched off, leaving rows visibly queued, when no relay is configured', async () => {
    const { pool, calls } = makePool([])
    const dispatcher = new EmailDispatcher(pool, { ...makeConfig(), SMTP_HOST: '' } as Config)

    expect(dispatcher.enabled).toBe(false)
    dispatcher.start()
    await dispatcher.stop()

    expect(calls).toHaveLength(0)
  })
})
