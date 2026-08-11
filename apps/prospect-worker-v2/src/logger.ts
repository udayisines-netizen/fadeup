type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  [key: string]: unknown
}

/**
 * Structured JSON logging to stdout/stderr — one line per event, safe for
 * a container log driver to ship as-is. Never logs a raw error object
 * directly (stack traces go under `stack`, never interpolated into
 * `message`) and callers are responsible for never passing a secret
 * (API key, DB password) as a field — see docs/worker-v2/operations.md.
 */
class Logger {
  constructor(private readonly base: LogFields = {}) {}

  child(fields: LogFields): Logger {
    return new Logger({ ...this.base, ...fields })
  }

  debug(message: string, fields: LogFields = {}): void {
    this.write('debug', message, fields)
  }

  info(message: string, fields: LogFields = {}): void {
    this.write('info', message, fields)
  }

  warn(message: string, fields: LogFields = {}): void {
    this.write('warn', message, fields)
  }

  error(message: string, error?: unknown, fields: LogFields = {}): void {
    const errorFields =
      error instanceof Error
        ? { error_message: error.message, error_name: error.name, stack: error.stack }
        : error !== undefined
          ? { error_message: String(error) }
          : {}
    this.write('error', message, { ...fields, ...errorFields })
  }

  private write(level: Level, message: string, fields: LogFields): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.base,
      ...fields,
    })
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n')
    } else {
      process.stdout.write(line + '\n')
    }
  }
}

export const logger = new Logger()
export type { Logger }
