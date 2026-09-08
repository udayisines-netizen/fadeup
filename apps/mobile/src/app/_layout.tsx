// URL/URLSearchParams complets pour supabase-js sous Hermes — DOIT précéder
// tout import qui touche le client (guide Supabase React Native).
import 'react-native-url-polyfill/auto'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins'
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono'
import { QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { initI18n } from '@/shared/i18n'
import { createQueryClient } from '@/shared/data/queryClient'
import { readOnboarding } from '@/features/onboarding/storage'
import { OnboardingGateContext } from '@/features/onboarding/gate'
import { color } from '@/shared/theme/tokens'

/**
 * Racine de l'application — polices D1 (Poppins interface client, Geist Mono
 * pour les chiffres), i18n fr/en, TanStack Query, et la porte d'onboarding.
 *
 * L'onboarding n'est PAS un mur : trois questions passables, puis le
 * résultat immédiatement — jamais d'écran de connexion (M1a §7). La porte ne
 * fait que rediriger la PREMIÈRE ouverture vers (onboarding).
 */

SplashScreen.preventAutoHideAsync().catch(() => {})

const queryClient = createQueryClient()
const i18n = initI18n()

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  })

  /** null = pas encore lu ; ensuite : l'onboarding est-il déjà passé ? */
  const [onboarded, setOnboarded] = useState<boolean | null>(null)

  useEffect(() => {
    void readOnboarding().then((answers) => setOnboarded(answers !== null))
  }, [])

  const ready = fontsLoaded && onboarded !== null

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) {
    // Le splash natif couvre cet état — rien à peindre nous-mêmes.
    return <View style={{ flex: 1, backgroundColor: color.canvas }} />
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <OnboardingGateContext.Provider
            value={{ onboarded: onboarded === true, markOnboarded: () => setOnboarded(true) }}
          >
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: color.canvas },
              }}
            >
              <Stack.Protected guard={!onboarded}>
                <Stack.Screen name="(onboarding)" />
              </Stack.Protected>
              <Stack.Protected guard={onboarded === true}>
                <Stack.Screen name="(tabs)" />
              </Stack.Protected>
            </Stack>
          </OnboardingGateContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </GestureHandlerRootView>
  )
}
