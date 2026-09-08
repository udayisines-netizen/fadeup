import { createContext, useContext } from 'react'

/**
 * La porte d'onboarding — le layout racine possède l'état (lu d'AsyncStorage
 * au démarrage) et les écrans d'onboarding la referment à la fin :
 * `Stack.Protected` bascule alors de (onboarding) vers (tabs).
 */
export interface OnboardingGate {
  onboarded: boolean
  markOnboarded: () => void
}

export const OnboardingGateContext = createContext<OnboardingGate>({
  onboarded: false,
  markOnboarded: () => {},
})

export function useOnboardingGate(): OnboardingGate {
  return useContext(OnboardingGateContext)
}
