import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import {
  rankResults,
} from '@/shared/lib/searchRanking'
import {
  rowAvailability,
  useProfessionalSearchSlice,
  useResultCurrencies,
  useResultServiceStates,
  type ProfessionalSearchRow,
} from '@/shared/data/discovery'
import { discoveryKeys } from '@/shared/data/keys'
import { readRecentProfiles, type RecentProfile } from '@/shared/lib/recentProfiles'
import { demoBanner, resolveMediaSource } from '@/shared/lib/demoMedia'
import { Avatar } from '@/shared/ui/Avatar'
import { FuText } from '@/shared/ui/Text'
import { ResultCard } from '@/shared/ui/ResultCard'
import { ResultSheet } from '@/shared/ui/ResultSheet'
import { Skeleton } from '@/shared/ui/Skeleton'
import { color, radius, shadow, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * D1 §7 transposé — l'accueil tableau de bord, cas ANONYME (M1a n'a pas de
 * compte ; « En cours » et « Ce que je suis » arrivent avec M1b) :
 * recherche → « Vous avez consulté » (mémoire LOCALE, jamais envoyée au
 * serveur) → « À découvrir » (résultats réels, cartes + feuille).
 * Première visite : recherche + découverte, AUCUNE section vide.
 * AUCUNE géolocalisation à l'ouverture — « Autour de moi » vit sur /search,
 * à un tap (loi produit §3).
 */

const DISCOVERY_COUNT = 6

export function HomeScreen() {
  const { t } = useTranslation('v2')
  const router = useRouter()

  const [recent, setRecent] = useState<RecentProfile[]>([])
  const [selected, setSelected] = useState<ProfessionalSearchRow | null>(null)

  // Relu à CHAQUE focus : un profil consulté puis retour → il apparaît.
  useFocusEffect(
    useCallback(() => {
      let alive = true
      void readRecentProfiles().then((entries) => {
        if (alive) setRecent(entries)
      })
      return () => {
        alive = false
      }
    }, []),
  )

  /* « À découvrir » — la recherche publique réelle, sans point (pas de géo
     à l'ouverture), classée par disponibilité réelle une fois résolue. */
  const discoveryArgs = useMemo(() => ({ p_limit: DISCOVERY_COUNT }), [])
  const discovery = useProfessionalSearchSlice(
    discoveryKeys.search({ surface: 'home-discover', p_limit: DISCOVERY_COUNT }),
    discoveryArgs,
  )
  const rows = useMemo(() => discovery.data ?? [], [discovery.data])
  const currencies = useResultCurrencies(rows.map((row) => row.organization_id))
  const serviceStates = useResultServiceStates(
    rows.map((row) => ({ slug: row.organization_slug, locationId: row.location_id })),
  )
  const availabilityByLocation = useMemo(
    () => Object.fromEntries(rows.map((row) => [row.location_id, rowAvailability(row, serviceStates)])),
    [rows, serviceStates],
  )
  const ranked = useMemo(
    () =>
      serviceStates.settled ? rankResults(rows, availabilityByLocation, 'recommended', false) : rows,
    [rows, serviceStates, availabilityByLocation],
  )

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <FuText variant="heading">{t('home.search.title')}</FuText>

        {/* La recherche — le champ route vers l'onglet Recherche. */}
        <Pressable
          accessibilityRole="search"
          accessibilityLabel={t('home.search.label')}
          onPress={() => router.push('/search')}
          style={[styles.searchField, shadow.card]}
        >
          <Ionicons name="search-outline" size={18} color={color.textSecondary} />
          <FuText variant="body" tone="tertiary">
            {t('home.search.placeholder')}
          </FuText>
        </Pressable>

        {/* « Vous avez consulté » — mémoire locale, dès qu'elle existe. */}
        {recent.length > 0 ? (
          <View style={styles.section}>
            <FuText variant="title">{t('home.recent.title')}</FuText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
              {recent.map((profile) => (
                <Pressable
                  key={`${profile.kind}-${profile.key}`}
                  accessibilityRole="button"
                  accessibilityLabel={profile.name}
                  onPress={() =>
                    router.push(
                      profile.kind === 'pro'
                        ? `/pro/${encodeURIComponent(profile.key)}`
                        : (`/shop/${encodeURIComponent(profile.key)}` as never),
                    )
                  }
                  style={styles.recentItem}
                >
                  <Avatar
                    name={profile.name}
                    src={resolveMediaSource(profile.avatarUrl) ?? demoBanner(profile.organizationSlug)}
                    size="lg"
                  />
                  <FuText variant="badge" tone="secondary" numberOfLines={1} style={styles.recentName}>
                    {profile.name}
                  </FuText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* « À découvrir » — des établissements RÉELS, cartes + feuille. */}
        <View style={styles.section}>
          <FuText variant="title">{t('home.discover.title')}</FuText>
          {discovery.isPending ? (
            <View style={styles.skeletons} accessibilityElementsHidden>
              <Skeleton height={200} />
              <Skeleton height={200} />
            </View>
          ) : (
            ranked.map((row) => (
              <View key={row.location_id} style={styles.cardWrap}>
                <ResultCard
                  row={row}
                  currencyByOrganization={currencies.data}
                  availability={rowAvailability(row, serviceStates)}
                  onOpen={setSelected}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <ResultSheet
        row={selected}
        currencyByOrganization={currencies.data}
        availability={selected ? rowAvailability(selected, serviceStates) : 'loading'}
        onClose={() => setSelected(null)}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  content: { paddingHorizontal: spacing(4), paddingTop: spacing(2), paddingBottom: spacing(8), gap: spacing(5) },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing(4),
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },
  section: { gap: spacing(3) },
  recentRow: { gap: spacing(3), paddingEnd: spacing(2) },
  recentItem: { alignItems: 'center', width: 72, gap: spacing(1) },
  recentName: { textAlign: 'center' },
  cardWrap: {},
  skeletons: { gap: spacing(3) },
})
