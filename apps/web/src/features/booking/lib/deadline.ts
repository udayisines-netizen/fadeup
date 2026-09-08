/**
 * P1PRO — les dérivés d'échéance vivent désormais dans shared/lib (le pro
 * les lit aussi : features/X n'importe jamais features/Y). Ré-export pour
 * les surfaces booking existantes.
 */
export * from '@/shared/lib/deadline'
