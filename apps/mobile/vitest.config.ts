import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * Tests de LOGIQUE uniquement (M1a §10) : les modules purs (état de
 * recherche, états de service, formatage, classement, horaires) n'importent
 * ni React Native ni Expo — ils tournent sous Node, sans simulateur.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: { __DEV__: 'true' },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
