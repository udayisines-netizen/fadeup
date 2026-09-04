/**
 * THE icon module (P1b §6). Outline family, constant stroke, minimal —
 * consumer and pro share it. Every icon the product uses is exported from
 * here under its SEMANTIC name; no component imports lucide-react directly,
 * and no decorative icons exist outside this selection.
 */

export {
  // Navigation consumer
  Home as IconHome,
  Search as IconSearch,
  Newspaper as IconFeed,
  CalendarCheck as IconBookings,
  CircleUser as IconAccount,
  // Actions produit
  CalendarPlus as IconBook,
  UserPlus as IconFollow,
  Heart as IconLike,
  Share2 as IconShare,
  SlidersHorizontal as IconFilter,
  // Contexte
  MapPin as IconLocation,
  ListOrdered as IconQueue,
  Calendar as IconCalendar,
  Users as IconClients,
  ChartColumn as IconAnalytics,
  UsersRound as IconTeam,
  Scissors as IconServices,
  Settings as IconSettings,
  Map as IconMap,
  ArrowLeft as IconBack,
  // Chrome d'interface (primitives uniquement)
  Check as IconCheck,
  X as IconClose,
  ChevronDown as IconChevronDown,
  ChevronLeft as IconChevronLeft,
  ChevronRight as IconChevronRight,
  Star as IconStar,
  Camera as IconCamera,
  CircleAlert as IconError,
  Info as IconInfo,
  WifiOff as IconOffline,
  Clock as IconPending,
  QrCode as IconQr,
  Eye as IconShowPassword,
  EyeOff as IconHidePassword,
  Mail as IconEmail,
  LogOut as IconSignOut,
  Menu as IconMenu,
  Globe as IconLanguage,
  BadgeCheck as IconVerified,
  Store as IconShop,
  MessageSquare as IconReviews,
} from 'lucide-react'
