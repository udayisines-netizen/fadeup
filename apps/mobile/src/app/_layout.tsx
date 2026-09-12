// URL/URLSearchParams complets pour supabase-js sous Hermes — DOIT précéder
// tout import qui touche le client (guide Supabase React Native).
import 'react-native-url-polyfill/auto'
import { useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
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
import { focusManager } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { I18nextProvider } from 'react-i18next'
import { initI18n } from '@/shared/i18n'
import { createQueryClient } from '@/shared/data/queryClient'
import {
  createQueryPersister,
  PERSISTED_MAX_AGE_MS,
  shouldDehydrateMutation,
  shouldDehydrateQuery,
} from '@/shared/data/persistence'
import { SessionContext, useProvideSession } from '@/shared/data/auth'
import { wireOnlineManager } from '@/shared/hooks/useIsOnline'
import { readOnboarding } from '@/features/onboarding/storage'
import { syncOnboardingToCustomerProfile } from '@/features/onboarding/api/profileSync'
import { OnboardingGateContext } from '@/features/onboarding/gate'
import { OfflineBanner } from '@/shared/ui/OfflineBanner'
import { PushBridge } from '@/features/notifications/PushBridge'
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

/* M1c-a — le hors-ligne. SEULES les données stables sont persistées (liste
   blanche explicite dans persistence.ts) : réservations, demandes d'intérêt,
   et la place réservée au Passport. La position dans la file n'y est PAS, et
   ne doit jamais y être — un chiffre vieux de dix minutes envoie un client
   au salon alors qu'il a déjà été appelé. */
const queryPersister = createQueryPersister()

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

  // M1b — réseau et retour d'app alimentent TanStack Query : les requêtes se
  // suspendent hors connexion et repartent au retour au premier plan (la
  // stratégie de rafraîchissement laissée ouverte par M1a §13.6).
  useEffect(() => wireOnlineManager(), [])
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active')
    })
    return () => sub.remove()
  }, [])

  // M1b — session partagée + synchro onboarding local → customer_profiles à
  // l'arrivée d'une session (remplit les trous, n'écrase jamais la base).
  const sessionState = useProvideSession()
  const userId = sessionState.session?.user.id ?? null
  useEffect(() => {
    if (userId) void syncOnboardingToCustomerProfile()
  }, [userId])

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
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: PERSISTED_MAX_AGE_MS,
            /* `shouldDehydrateMutation` est OBLIGATOIRE ici : sans lui, le
               défaut de la librairie persiste les variables des mutations en
               pause — nom, téléphone, GPS, jeton de pointage. */
            dehydrateOptions: { shouldDehydrateQuery, shouldDehydrateMutation },
          }}
        >
          <SessionContext.Provider value={sessionState}>
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
            <OfflineBanner />
            {/* M1c-a — ne DEMANDE rien : pose le comportement au premier plan,
                route le toucher d'une notification, et rattache l'appareil au
                compte à l'arrivée d'une session. */}
            <PushBridge />
          </OnboardingGateContext.Provider>
          </SessionContext.Provider>
        </PersistQueryClientProvider>
      </I18nextProvider>
    </GestureHandlerRootView>
  )
}
