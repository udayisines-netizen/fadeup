import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { ProspectWorker } from './worker.js'

const config = loadConfig()
const worker = new ProspectWorker(config)

let shuttingDown = false
async function handleShutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('received shutdown signal', { signal })
  await worker.stop()
  process.exit(0)
}

process.on('SIGTERM', () => void handleShutdown('SIGTERM'))
process.on('SIGINT', () => void handleShutdown('SIGINT'))

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', reason)
})

await worker.start()
