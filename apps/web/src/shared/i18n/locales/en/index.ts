import common from './common.json'
import auth from './auth.json'
import nav from './nav.json'
import errors from './errors.json'
import states from './states.json'
import empty from './empty.json'
import demo from './demo.json'
import queue from './queue.json'
import profile from './profile.json'
import discovery from './discovery.json'
import home from './home.json'
import booking from './booking.json'
import pro from './pro.json'
import type { V2Section } from '@/shared/i18n/namespaces'

/**
 * PERF — agrégateur par locale : importé DYNAMIQUEMENT par
 * `shared/i18n/index.ts`, il forme un chunk par langue au lieu d'embarquer
 * fr ET en dans l'entrée consumer (~38 Ko de sources JSON, mesuré).
 */
const sections: Record<V2Section, object> = {
  common,
  auth,
  nav,
  errors,
  states,
  empty,
  demo,
  queue,
  profile,
  discovery,
  home,
  booking,
  pro,
}

export default sections
