/**
 * Localized UI strings for shared components (#1772).
 *
 * Shared components render in the editor AND in the generator/bollardbuddy
 * islands, and only the editor mounts a react-intl IntlProvider — so, like the
 * number/price helpers in `@shared/utils/format`, these strings are resolved
 * framework-free with a small curated table keyed by locale (the same approach
 * as PERIOD_SUFFIX there). The active locale comes from the same `locale`
 * localStorage key the editor persists, falling back to the browser language.
 *
 * These strings are NOT part of the formatjs extraction pipeline (that scans
 * for FormattedMessage/defineMessages and feeds the editor-only catalogs), so
 * translations here are hand-maintained. Keep terminology in sync with the
 * editor catalogs in src/editor/i18n/locales/ (assets: es/pt "recursos",
 * fr "actifs"; geo tokens: es "geotokens", pt "tokens geo", fr "jetons géo").
 *
 * Usage in React components (live-updates when the editor switches language):
 *   const t = useSharedMessages();
 *   <span>{t('openProfile')}</span>
 *
 * Usage in plain modules (resolved per call, e.g. pricing getters):
 *   formatSharedMessage('billedYearly', { total: '$84', period: '/year' })
 */

import { useCallback, useSyncExternalStore } from 'react';
import { getActiveLocale } from '../utils/format';
import { DEFAULT_LOCALE } from './locales';

const SHARED_MESSAGES = {
  // Billing cycle detail (UpgradeModal pricing)
  billedMonthly: {
    en: 'billed monthly',
    es: 'facturado mensualmente',
    'pt-BR': 'cobrado mensalmente',
    fr: 'facturé mensuellement'
  },
  billedYearly: {
    en: 'billed yearly, {total}{period}',
    es: 'facturado anualmente, {total}{period}',
    'pt-BR': 'cobrado anualmente, {total}{period}',
    fr: 'facturé annuellement, {total}{period}'
  },

  // ProfileButton tooltips
  openProfile: {
    en: 'Open profile',
    es: 'Abrir perfil',
    'pt-BR': 'Abrir perfil',
    fr: 'Ouvrir le profil'
  },
  signIn: {
    en: 'Sign in',
    es: 'Iniciar sesión',
    'pt-BR': 'Fazer login',
    fr: 'Se connecter'
  },

  // Token labels + details hover card
  geoTokens: {
    en: 'Geo Tokens',
    es: 'Geotokens',
    'pt-BR': 'Tokens Geo',
    fr: 'Jetons géo'
  },
  aiGenerationTokens: {
    en: 'AI Generation Tokens',
    es: 'Tokens de generación IA',
    'pt-BR': 'Tokens de geração de IA',
    fr: 'Jetons de génération IA'
  },
  geoTokensDescription: {
    en: 'Used for geospatial features like 3D map tiles and location services.',
    es: 'Se usan para funciones geoespaciales como mosaicos de mapas 3D y servicios de ubicación.',
    'pt-BR':
      'Usados para recursos geoespaciais como blocos de mapa 3D e serviços de localização.',
    fr: 'Utilisés pour les fonctions géospatiales comme les tuiles de carte 3D et les services de localisation.'
  },
  genTokensDescription: {
    en: 'Used for AI-powered image and video generation.',
    es: 'Se usan para la generación de imágenes y videos con IA.',
    'pt-BR': 'Usados para geração de imagens e vídeos com IA.',
    fr: "Utilisés pour la génération d'images et de vidéos par IA."
  },
  currentBalance: {
    en: 'Current Balance:',
    es: 'Saldo actual:',
    'pt-BR': 'Saldo atual:',
    fr: 'Solde actuel :'
  },
  outOfTokensWarning: {
    en: 'You are out of {tokenLabel}!',
    es: '¡Te quedaste sin {tokenLabel}!',
    'pt-BR': 'Você ficou sem {tokenLabel}!',
    fr: "Vous n'avez plus de {tokenLabel} !"
  },
  lowTokensWarning: {
    en: 'You are running low on {tokenLabel}!',
    es: '¡Te quedan pocos {tokenLabel}!',
    'pt-BR': 'Seus {tokenLabel} estão acabando!',
    fr: 'Il ne vous reste presque plus de {tokenLabel} !'
  },
  getMoreTokens: {
    en: 'Get More Tokens',
    es: 'Obtener más tokens',
    'pt-BR': 'Obter mais tokens',
    fr: 'Obtenir plus de jetons'
  },
  tokenUsage: {
    en: 'Token Usage:',
    es: 'Uso de tokens:',
    'pt-BR': 'Uso de tokens:',
    fr: 'Utilisation des jetons :'
  },
  tipImageGeneration: {
    en: '1 token = 1 image generation',
    es: '1 token = 1 generación de imagen',
    'pt-BR': '1 token = 1 geração de imagem',
    fr: "1 jeton = 1 génération d'image"
  },
  tipVideoGeneration: {
    en: '2 tokens = 1 second of video generation',
    es: '2 tokens = 1 segundo de generación de video',
    'pt-BR': '2 tokens = 1 segundo de geração de vídeo',
    fr: '2 jetons = 1 seconde de génération de vidéo'
  },
  tipMapTile: {
    en: '1 token = 1 map tile request',
    es: '1 token = 1 solicitud de mosaico de mapa',
    'pt-BR': '1 token = 1 solicitação de bloco de mapa',
    fr: '1 jeton = 1 requête de tuile de carte'
  },
  tipLocationServices: {
    en: 'Location services use tokens',
    es: 'Los servicios de ubicación usan tokens',
    'pt-BR': 'Serviços de localização usam tokens',
    fr: 'Les services de localisation utilisent des jetons'
  },
  tipGeospatialFeatures: {
    en: 'Geospatial features require tokens',
    es: 'Las funciones geoespaciales requieren tokens',
    'pt-BR': 'Recursos geoespaciais exigem tokens',
    fr: 'Les fonctions géospatiales nécessitent des jetons'
  },

  // Assets panel filter tabs
  filterAll: { en: 'All', es: 'Todos', 'pt-BR': 'Todos', fr: 'Tous' },
  filterMeshes: {
    en: 'Meshes',
    es: 'Mallas',
    'pt-BR': 'Malhas',
    fr: 'Maillages'
  },
  // "Splat" is a technical term (Gaussian splats) kept untranslated, matching
  // the editor catalogs.
  filterSplats: { en: 'Splats', es: 'Splats', 'pt-BR': 'Splats', fr: 'Splats' },
  filterImages: {
    en: 'Images',
    es: 'Imágenes',
    'pt-BR': 'Imagens',
    fr: 'Images'
  },
  filterVideo: { en: 'Video', es: 'Video', 'pt-BR': 'Vídeo', fr: 'Vidéo' },

  // Assets empty/loading states
  noAssetsYet: {
    en: 'No assets yet',
    es: 'Aún no hay recursos',
    'pt-BR': 'Ainda não há recursos',
    fr: 'Aucun actif pour le moment'
  },
  noAssetsYetUploadHint: {
    en: 'No assets yet. Drag GLB or image files in, or click Upload.',
    es: 'Aún no hay recursos. Arrastra archivos GLB o de imagen, o haz clic en Subir.',
    'pt-BR':
      'Ainda não há recursos. Arraste arquivos GLB ou de imagem, ou clique em Enviar.',
    fr: 'Aucun actif pour le moment. Glissez des fichiers GLB ou image, ou cliquez sur Téléverser.'
  },
  noMeshAssetsYet: {
    en: 'No mesh assets yet.',
    es: 'Aún no hay recursos de malla.',
    'pt-BR': 'Ainda não há recursos de malha.',
    fr: 'Aucun maillage pour le moment.'
  },
  noSplatAssetsYet: {
    en: 'No splat assets yet.',
    es: 'Aún no hay recursos de splat.',
    'pt-BR': 'Ainda não há recursos de splat.',
    fr: 'Aucun splat pour le moment.'
  },
  noImageAssetsYet: {
    en: 'No image assets yet.',
    es: 'Aún no hay recursos de imagen.',
    'pt-BR': 'Ainda não há recursos de imagem.',
    fr: 'Aucune image pour le moment.'
  },
  noVideoAssetsYet: {
    en: 'No video assets yet.',
    es: 'Aún no hay recursos de video.',
    'pt-BR': 'Ainda não há recursos de vídeo.',
    fr: 'Aucune vidéo pour le moment.'
  },
  loadingGallery: {
    en: 'Loading gallery...',
    es: 'Cargando galería...',
    'pt-BR': 'Carregando galeria...',
    fr: 'Chargement de la galerie...'
  },

  // Assets panel chrome
  signInToViewAssets: {
    en: 'Sign in to view your assets.',
    es: 'Inicia sesión para ver tus recursos.',
    'pt-BR': 'Faça login para ver seus recursos.',
    fr: 'Connectez-vous pour voir vos actifs.'
  },
  upload: {
    en: 'Upload',
    es: 'Subir',
    'pt-BR': 'Enviar',
    fr: 'Téléverser'
  },
  uploading: {
    en: 'Uploading…',
    es: 'Subiendo…',
    'pt-BR': 'Enviando…',
    fr: 'Téléversement…'
  },
  uploadAnAsset: {
    en: 'Upload an asset',
    es: 'Subir un recurso',
    'pt-BR': 'Enviar um recurso',
    fr: 'Téléverser un actif'
  },
  uploadInProgress: {
    en: 'An upload is already in progress',
    es: 'Ya hay una subida en curso',
    'pt-BR': 'Já há um envio em andamento',
    fr: 'Un téléversement est déjà en cours'
  },
  refreshAssets: {
    en: 'Refresh assets',
    es: 'Actualizar recursos',
    'pt-BR': 'Atualizar recursos',
    fr: 'Actualiser les actifs'
  },
  itemSingular: { en: 'item', es: 'elemento', 'pt-BR': 'item', fr: 'élément' },
  itemPlural: {
    en: 'items',
    es: 'elementos',
    'pt-BR': 'itens',
    fr: 'éléments'
  }
};

/**
 * Resolves a shared message id to the active locale's string, interpolating
 * simple {placeholder} values. Unknown ids return the id itself (loud enough
 * to spot in the UI, safe enough not to crash).
 */
export function formatSharedMessage(
  id,
  values,
  { locale = getActiveLocale() } = {}
) {
  const entry = SHARED_MESSAGES[id];
  if (!entry) return id;
  const template = entry[locale] || entry[DEFAULT_LOCALE];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}

/**
 * The editor dispatches this on its language switcher so shared components
 * (which don't subscribe to the editor's Zustand store) re-render with the new
 * language. The generator has no switcher — its locale is fixed per page load.
 */
export const LOCALE_CHANGED_EVENT = '3dstreet-locale-changed';

export function notifyLocaleChanged() {
  try {
    window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT));
  } catch {
    // window unavailable (tests/SSR)
  }
}

function subscribeToLocale(callback) {
  window.addEventListener(LOCALE_CHANGED_EVENT, callback);
  // Cross-tab: another tab persisted a new locale to localStorage.
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(LOCALE_CHANGED_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

/**
 * The active shared locale as React state — re-renders on locale change.
 */
export function useSharedLocale() {
  return useSyncExternalStore(
    subscribeToLocale,
    getActiveLocale,
    () => DEFAULT_LOCALE
  );
}

/**
 * Returns a `t(id, values)` bound to the live locale for use in shared React
 * components.
 */
export function useSharedMessages() {
  const locale = useSharedLocale();
  return useCallback(
    (id, values) => formatSharedMessage(id, values, { locale }),
    [locale]
  );
}
