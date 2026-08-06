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

  // Profile menu (shared dropdown used in the generator + Bollard Buddy)
  manageAccount: {
    en: 'Manage Account',
    es: 'Administrar cuenta',
    'pt-BR': 'Gerenciar conta',
    fr: 'Gérer le compte'
  },
  logOut: {
    en: 'Log Out',
    es: 'Cerrar sesión',
    'pt-BR': 'Sair',
    fr: 'Se déconnecter'
  },
  loadingUsername: {
    en: 'Loading username…',
    es: 'Cargando nombre de usuario…',
    'pt-BR': 'Carregando nome de usuário…',
    fr: "Chargement du nom d'utilisateur…"
  },
  notSignedIn: {
    en: 'Not signed in',
    es: 'Sesión no iniciada',
    'pt-BR': 'Não conectado',
    fr: 'Non connecté'
  },
  signInOrCreateAccount: {
    en: 'Sign in or create account',
    es: 'Inicia sesión o crea una cuenta',
    'pt-BR': 'Entrar ou criar conta',
    fr: 'Se connecter ou créer un compte'
  },
  language: {
    en: 'Language',
    es: 'Idioma',
    'pt-BR': 'Idioma',
    fr: 'Langue'
  },
  // Shown in the confirm-before-reload dialog when switching language in an app
  // that reloads to apply it (the generator). {from}/{to} are language endonyms
  // and are never translated. The dialog renders this in BOTH the current and
  // the requested language.
  reloadLanguageConfirm: {
    en: 'Reload to switch language from {from} to {to}?',
    es: '¿Recargar para cambiar el idioma de {from} a {to}?',
    'pt-BR': 'Recarregar para mudar o idioma de {from} para {to}?',
    fr: 'Recharger pour changer la langue de {from} à {to} ?'
  },
  cancel: {
    en: 'Cancel',
    es: 'Cancelar',
    'pt-BR': 'Cancelar',
    fr: 'Annuler'
  },
  reload: {
    en: 'Reload',
    es: 'Recargar',
    'pt-BR': 'Recarregar',
    fr: 'Recharger'
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

  // BuyTokensModal — one-time token pack purchases (#1374). Pack names
  // (Starter/Standard/Power) are deliberately untranslated, same as the
  // Pro/Max tier names.
  buyTokensTitle: {
    en: 'Buy More Tokens',
    es: 'Comprar más tokens',
    'pt-BR': 'Comprar mais tokens',
    fr: 'Acheter plus de jetons'
  },
  buyTokensSubtitle: {
    en: 'One-time token packs for your AI generations.',
    es: 'Paquetes de tokens de pago único para tus generaciones con IA.',
    'pt-BR': 'Pacotes de tokens de compra única para suas gerações com IA.',
    fr: 'Des packs de jetons à achat unique pour vos générations IA.'
  },
  buyTokensSignInPrompt: {
    en: 'Sign in to purchase tokens.',
    es: 'Inicia sesión para comprar tokens.',
    'pt-BR': 'Faça login para comprar tokens.',
    fr: 'Connectez-vous pour acheter des jetons.'
  },
  signInToCloud: {
    en: 'Sign in to 3DStreet Cloud',
    es: 'Iniciar sesión en 3DStreet Cloud',
    'pt-BR': 'Entrar no 3DStreet Cloud',
    fr: 'Se connecter à 3DStreet Cloud'
  },
  buyTokensPaidPlanOnly: {
    en: 'Token packs are available on Pro and Max plans. Upgrade to get a monthly token allowance plus the option to buy more anytime.',
    es: 'Los paquetes de tokens están disponibles en los planes Pro y Max. Mejora tu plan para obtener una asignación mensual de tokens y la opción de comprar más en cualquier momento.',
    'pt-BR':
      'Os pacotes de tokens estão disponíveis nos planos Pro e Max. Faça upgrade para receber uma cota mensal de tokens e a opção de comprar mais a qualquer momento.',
    fr: "Les packs de jetons sont disponibles avec les forfaits Pro et Max. Passez à un forfait supérieur pour obtenir une allocation mensuelle de jetons et la possibilité d'en acheter davantage à tout moment."
  },
  upgradeToPro: {
    en: 'Upgrade to Pro',
    es: 'Mejorar a Pro',
    'pt-BR': 'Fazer upgrade para o Pro',
    fr: 'Passer à Pro'
  },
  buyTokensOneTime: {
    en: 'one-time',
    es: 'pago único',
    'pt-BR': 'pagamento único',
    fr: 'paiement unique'
  },
  buyTokensPackTokens: {
    en: '{tokens} AI tokens',
    es: '{tokens} tokens de IA',
    'pt-BR': '{tokens} tokens de IA',
    fr: '{tokens} jetons IA'
  },
  buyTokensBuyCta: {
    en: 'Buy {name}',
    es: 'Comprar {name}',
    'pt-BR': 'Comprar {name}',
    fr: 'Acheter {name}'
  },
  buy: {
    en: 'Buy',
    es: 'Comprar',
    'pt-BR': 'Comprar',
    fr: 'Acheter'
  },
  buyTokensUnavailable: {
    en: 'Token packs are not available yet on this deployment. Please check back soon.',
    es: 'Los paquetes de tokens aún no están disponibles en esta versión. Vuelve pronto.',
    'pt-BR':
      'Os pacotes de tokens ainda não estão disponíveis nesta versão. Volte em breve.',
    fr: 'Les packs de jetons ne sont pas encore disponibles sur ce déploiement. Revenez bientôt.'
  },
  buyTokensCheckoutTitle: {
    en: 'Complete your purchase',
    es: 'Completa tu compra',
    'pt-BR': 'Conclua sua compra',
    fr: 'Finalisez votre achat'
  },
  buyTokensSuccessTitle: {
    en: 'Tokens Added!',
    es: '¡Tokens añadidos!',
    'pt-BR': 'Tokens adicionados!',
    fr: 'Jetons ajoutés !'
  },
  buyTokensSuccessMessage: {
    en: '{tokens} tokens are now on your account.',
    es: '{tokens} tokens ya están en tu cuenta.',
    'pt-BR': '{tokens} tokens já estão na sua conta.',
    fr: '{tokens} jetons ont été ajoutés à votre compte.'
  },
  back: {
    en: 'Back',
    es: 'Atrás',
    'pt-BR': 'Voltar',
    fr: 'Retour'
  },
  close: {
    en: 'Close',
    es: 'Cerrar',
    'pt-BR': 'Fechar',
    fr: 'Fermer'
  },
  done: {
    en: 'Done',
    es: 'Listo',
    'pt-BR': 'Concluído',
    fr: 'Terminé'
  },

  // Plan feature lines — shared pool referenced by id from UpgradeModal's
  // default list and the paywallSurfaces registry (featureIds arrays).
  featTokensMonthly: {
    en: '{tokens} AI generation tokens / month',
    es: '{tokens} tokens de generación IA al mes',
    'pt-BR': '{tokens} tokens de geração de IA por mês',
    fr: '{tokens} jetons de génération IA par mois'
  },
  featWatermark: {
    en: 'Download JPEG snapshots without watermark',
    es: 'Descarga instantáneas JPEG sin marca de agua',
    'pt-BR': "Baixe instantâneos JPEG sem marca d'água",
    fr: 'Téléchargez des instantanés JPEG sans filigrane'
  },
  featGeoUnlimited: {
    en: 'Unlimited geospatial maps & location changes',
    es: 'Mapas geoespaciales y cambios de ubicación ilimitados',
    'pt-BR': 'Mapas geoespaciais e mudanças de localização ilimitados',
    fr: 'Cartes géospatiales et changements de lieu illimités'
  },
  featHdRenders: {
    en: 'HD renders, AR-ready glTF & video export',
    es: 'Renders HD, glTF listo para RA y exportación de video',
    'pt-BR': 'Renders em HD, glTF pronto para RA e exportação de vídeo',
    fr: 'Rendus HD, glTF prêt pour la RA et export vidéo'
  },
  featCustomModels: {
    en: 'Import custom 3D models & SVG / glTF files',
    es: 'Importa modelos 3D personalizados y archivos SVG / glTF',
    'pt-BR': 'Importe modelos 3D personalizados e arquivos SVG / glTF',
    fr: 'Importez des modèles 3D personnalisés et des fichiers SVG / glTF'
  },
  featGlbExport: {
    en: 'GLB glTF & AR Ready GLB export',
    es: 'Exportación GLB glTF y GLB listo para RA',
    'pt-BR': 'Exportação GLB glTF e GLB pronto para RA',
    fr: 'Export GLB glTF et GLB prêt pour la RA'
  },
  featDxfExport: {
    en: 'DXF plan view export for AutoCAD & CAD tools',
    es: 'Exportación de plano DXF para AutoCAD y herramientas CAD',
    'pt-BR': 'Exportação de planta DXF para AutoCAD e ferramentas CAD',
    fr: 'Export de plan DXF pour AutoCAD et outils CAO'
  },
  featPdfDxfExport: {
    en: 'PDF & DXF plan view export',
    es: 'Exportación de planos en PDF y DXF',
    'pt-BR': 'Exportação de plantas em PDF e DXF',
    fr: 'Export de plans PDF et DXF'
  },
  featStorage5gb: {
    en: '5 GB custom model & asset storage',
    es: '5 GB de almacenamiento para modelos y recursos personalizados',
    'pt-BR': '5 GB de armazenamento para modelos e recursos personalizados',
    fr: '5 Go de stockage pour modèles et actifs personnalisés'
  },

  // UpgradeModal chrome
  unlockToolkit: {
    en: 'Unlock the full 3DStreet toolkit.',
    es: 'Desbloquea todas las herramientas de 3DStreet.',
    'pt-BR': 'Desbloqueie todas as ferramentas do 3DStreet.',
    fr: 'Débloquez tous les outils de 3DStreet.'
  },
  billingMonthly: {
    en: 'Monthly',
    es: 'Mensual',
    'pt-BR': 'Mensal',
    fr: 'Mensuel'
  },
  billingYearly: {
    en: 'Yearly',
    es: 'Anual',
    'pt-BR': 'Anual',
    fr: 'Annuel'
  },
  savePill: {
    en: 'Save 30%',
    es: 'Ahorra 30%',
    'pt-BR': 'Economize 30%',
    fr: 'Économisez 30 %'
  },
  cancelAnytime: {
    en: 'Cancel anytime',
    es: 'Cancela cuando quieras',
    'pt-BR': 'Cancele quando quiser',
    fr: 'Annulez à tout moment'
  },
  signInToUpgrade: {
    en: 'Sign in to upgrade or access Pro.',
    es: 'Inicia sesión para mejorar tu plan o acceder a Pro.',
    'pt-BR': 'Faça login para fazer upgrade ou acessar o Pro.',
    fr: 'Connectez-vous pour passer à Pro ou y accéder.'
  },
  planTokensPerMonth: {
    en: '{tokens} AI tokens / month',
    es: '{tokens} tokens de IA al mes',
    'pt-BR': '{tokens} tokens de IA por mês',
    fr: '{tokens} jetons IA par mois'
  },
  planStorage: {
    en: '{gb} GB asset storage',
    es: '{gb} GB de almacenamiento de recursos',
    'pt-BR': '{gb} GB de armazenamento de recursos',
    fr: "{gb} Go de stockage d'actifs"
  },
  // Tier names (Pro/Max) stay untranslated, so {tier} interpolates verbatim.
  goTier: {
    en: 'Go {tier}',
    es: 'Hazte {tier}',
    'pt-BR': 'Assine o {tier}',
    fr: 'Passer {tier}'
  },
  checkoutTitleUpgrade: {
    en: 'Complete your upgrade',
    es: 'Completa tu mejora',
    'pt-BR': 'Conclua seu upgrade',
    fr: 'Finalisez votre mise à niveau'
  },
  activeSubscriptionTitle: {
    en: 'Active Subscription',
    es: 'Suscripción activa',
    'pt-BR': 'Assinatura ativa',
    fr: 'Abonnement actif'
  },
  hasActiveSubscriptionHeading: {
    en: 'You Already Have an Active Subscription',
    es: 'Ya tienes una suscripción activa',
    'pt-BR': 'Você já tem uma assinatura ativa',
    fr: 'Vous avez déjà un abonnement actif'
  },
  subscriptionCountSingle: {
    en: 'You currently have 1 active subscription.',
    es: 'Actualmente tienes 1 suscripción activa.',
    'pt-BR': 'Atualmente você tem 1 assinatura ativa.',
    fr: 'Vous avez actuellement 1 abonnement actif.'
  },
  subscriptionCountMultiple: {
    en: 'You currently have {count} active subscriptions.',
    es: 'Actualmente tienes {count} suscripciones activas.',
    'pt-BR': 'Atualmente você tem {count} assinaturas ativas.',
    fr: 'Vous avez actuellement {count} abonnements actifs.'
  },
  multipleSubscriptionsNote: {
    en: 'Note: You have multiple subscriptions. Please manage them through the billing portal.',
    es: 'Nota: tienes varias suscripciones. Adminístralas desde el portal de facturación.',
    'pt-BR':
      'Observação: você tem várias assinaturas. Gerencie-as no portal de cobrança.',
    fr: 'Remarque : vous avez plusieurs abonnements. Gérez-les depuis le portail de facturation.'
  },
  billingPortalHint: {
    en: 'To add more tokens, manage your subscription, or upgrade/downgrade, please visit the billing portal.',
    es: 'Para añadir más tokens, administrar tu suscripción o cambiar de plan, visita el portal de facturación.',
    'pt-BR':
      'Para adicionar mais tokens, gerenciar sua assinatura ou mudar de plano, acesse o portal de cobrança.',
    fr: 'Pour ajouter des jetons, gérer votre abonnement ou changer de forfait, rendez-vous sur le portail de facturation.'
  },
  manageSubscription: {
    en: 'Manage Subscription',
    es: 'Administrar suscripción',
    'pt-BR': 'Gerenciar assinatura',
    fr: "Gérer l'abonnement"
  },
  welcomeToPro: {
    en: 'Welcome to Pro!',
    es: '¡Te damos la bienvenida a Pro!',
    'pt-BR': 'Boas-vindas ao Pro!',
    fr: 'Bienvenue dans Pro !'
  },
  proUnlocked: {
    en: 'Pro features are unlocked on your account.',
    es: 'Las funciones Pro están desbloqueadas en tu cuenta.',
    'pt-BR': 'Os recursos Pro estão desbloqueados na sua conta.',
    fr: 'Les fonctionnalités Pro sont débloquées sur votre compte.'
  },
  welcomeToMax: {
    en: 'Welcome to Max!',
    es: '¡Te damos la bienvenida a Max!',
    'pt-BR': 'Boas-vindas ao Max!',
    fr: 'Bienvenue dans Max !'
  },
  maxUnlocked: {
    en: 'Max features are unlocked on your account.',
    es: 'Las funciones Max están desbloqueadas en tu cuenta.',
    'pt-BR': 'Os recursos Max estão desbloqueados na sua conta.',
    fr: 'Les fonctionnalités Max sont débloquées sur votre compte.'
  },
  continueCta: {
    en: 'Continue',
    es: 'Continuar',
    'pt-BR': 'Continuar',
    fr: 'Continuer'
  },

  // EmbeddedCheckout status views
  processingPayment: {
    en: 'Processing your payment...',
    es: 'Procesando tu pago...',
    'pt-BR': 'Processando seu pagamento...',
    fr: 'Traitement de votre paiement...'
  },
  processingPaymentHint: {
    en: 'This usually takes just a few seconds',
    es: 'Esto suele tardar solo unos segundos',
    'pt-BR': 'Isso costuma levar só alguns segundos',
    fr: 'Cela ne prend généralement que quelques secondes'
  },
  almostThere: {
    en: 'Almost there!',
    es: '¡Ya casi está!',
    'pt-BR': 'Quase lá!',
    fr: 'Presque terminé !'
  },
  paymentFinalizing: {
    en: "Your payment went through and we're finalizing your account. A confirmation email is on the way. Refresh in a minute to see your updated balance.",
    es: 'Tu pago se realizó y estamos finalizando tu cuenta. Un correo de confirmación está en camino. Actualiza la página en un minuto para ver tu saldo actualizado.',
    'pt-BR':
      'Seu pagamento foi concluído e estamos finalizando sua conta. Um e-mail de confirmação está a caminho. Atualize a página em um minuto para ver seu saldo atualizado.',
    fr: 'Votre paiement a été effectué et nous finalisons votre compte. Un e-mail de confirmation est en route. Actualisez la page dans une minute pour voir votre solde à jour.'
  },
  paymentIssue: {
    en: 'Payment Issue',
    es: 'Problema con el pago',
    'pt-BR': 'Problema no pagamento',
    fr: 'Problème de paiement'
  },
  paymentErrorFallback: {
    en: 'Something went wrong with your payment. Please try again or contact support.',
    es: 'Algo salió mal con tu pago. Inténtalo de nuevo o contacta con soporte.',
    'pt-BR':
      'Algo deu errado com seu pagamento. Tente novamente ou entre em contato com o suporte.',
    fr: "Un problème est survenu avec votre paiement. Réessayez ou contactez l'assistance."
  },
  paymentSuccessTitle: {
    en: 'Payment Successful!',
    es: '¡Pago realizado!',
    'pt-BR': 'Pagamento concluído!',
    fr: 'Paiement réussi !'
  },
  paymentSuccessMessage: {
    en: 'Thanks for your purchase. Your account is ready to go.',
    es: 'Gracias por tu compra. Tu cuenta está lista.',
    'pt-BR': 'Obrigado pela sua compra. Sua conta está pronta.',
    fr: 'Merci pour votre achat. Votre compte est prêt.'
  },

  // Generator upgrade-success copy (mount-purchase-modal)
  genTokensReady: {
    en: 'Your tokens are ready — happy generating.',
    es: 'Tus tokens están listos: ¡a generar!',
    'pt-BR': 'Seus tokens estão prontos — boas gerações!',
    fr: 'Vos jetons sont prêts — bonnes générations !'
  },
  startGenerating: {
    en: 'Start Generating',
    es: 'Empezar a generar',
    'pt-BR': 'Começar a gerar',
    fr: 'Commencer à générer'
  },

  // Paywall surface registry (paywallSurfaces.jsx) — card/headline copy per
  // postCheckout surface. Format names (GLB glTF, file extensions) stay as-is.
  exportRequiresPro: {
    en: 'Export requires Pro',
    es: 'La exportación requiere Pro',
    'pt-BR': 'A exportação requer o Pro',
    fr: "L'export nécessite Pro"
  },
  surfaceExportTitle: {
    en: 'GLB glTF',
    es: 'GLB glTF',
    'pt-BR': 'GLB glTF',
    fr: 'GLB glTF'
  },
  surfaceExportSubtitle: {
    en: '.glb · 3D model export',
    es: '.glb · exportación de modelo 3D',
    'pt-BR': '.glb · exportação de modelo 3D',
    fr: '.glb · export de modèle 3D'
  },
  surfaceExportDesc: {
    en: 'GLB glTF export lets you use your 3D scene in any compatible tool, game engine, or AR platform.',
    es: 'La exportación GLB glTF te permite usar tu escena 3D en cualquier herramienta, motor de juegos o plataforma de RA compatible.',
    'pt-BR':
      'A exportação GLB glTF permite usar sua cena 3D em qualquer ferramenta, motor de jogos ou plataforma de RA compatível.',
    fr: "L'export GLB glTF vous permet d'utiliser votre scène 3D dans n'importe quel outil, moteur de jeu ou plateforme de RA compatible."
  },
  surfaceDxfTitle: {
    en: 'DXF Plan View',
    es: 'Plano DXF',
    'pt-BR': 'Planta DXF',
    fr: 'Plan DXF'
  },
  surfaceDxfSubtitle: {
    en: '.dxf · 2D CAD export',
    es: '.dxf · exportación CAD 2D',
    'pt-BR': '.dxf · exportação CAD 2D',
    fr: '.dxf · export CAO 2D'
  },
  surfaceDxfDesc: {
    en: 'DXF plan view export brings your street design into AutoCAD and other CAD tools as clean, layered 2D linework.',
    es: 'La exportación de plano DXF lleva tu diseño de calle a AutoCAD y otras herramientas CAD como líneas 2D limpias y organizadas por capas.',
    'pt-BR':
      'A exportação de planta DXF leva seu projeto de rua para o AutoCAD e outras ferramentas CAD como linhas 2D limpas e organizadas em camadas.',
    fr: "L'export de plan DXF transpose votre design de rue dans AutoCAD et d'autres outils CAO sous forme de tracés 2D propres et organisés en calques."
  },
  surfacePdfTitle: {
    en: 'PDF Plan View',
    es: 'Plano PDF',
    'pt-BR': 'Planta PDF',
    fr: 'Plan PDF'
  },
  surfacePdfSubtitle: {
    en: '.pdf · 2D plan export',
    es: '.pdf · exportación de plano 2D',
    'pt-BR': '.pdf · exportação de planta 2D',
    fr: '.pdf · export de plan 2D'
  },
  surfacePdfDesc: {
    en: 'PDF plan view export turns your street design into a print-ready vector plan you can publish and share anywhere.',
    es: 'La exportación de plano PDF convierte tu diseño de calle en un plano vectorial listo para imprimir que puedes publicar y compartir donde quieras.',
    'pt-BR':
      'A exportação de planta PDF transforma seu projeto de rua em uma planta vetorial pronta para impressão que você pode publicar e compartilhar em qualquer lugar.',
    fr: "L'export de plan PDF transforme votre design de rue en un plan vectoriel prêt à imprimer que vous pouvez publier et partager partout."
  },
  surfaceImageTitle: {
    en: 'AI Render',
    es: 'Render con IA',
    'pt-BR': 'Render com IA',
    fr: 'Rendu IA'
  },
  surfaceImageSubtitle: {
    en: 'Generation tokens · AI image rendering',
    es: 'Tokens de generación · renderizado de imágenes con IA',
    'pt-BR': 'Tokens de geração · renderização de imagens com IA',
    fr: "Jetons de génération · rendu d'images par IA"
  },
  surfaceImageHeadline: {
    en: 'More AI generation tokens',
    es: 'Más tokens de generación IA',
    'pt-BR': 'Mais tokens de geração de IA',
    fr: 'Plus de jetons de génération IA'
  },
  surfaceImageDesc: {
    en: 'AI renders use generation tokens. A paid plan refreshes your token balance every month so you can keep generating across every available AI model.',
    es: 'Los renders con IA usan tokens de generación. Un plan de pago renueva tu saldo de tokens cada mes para que sigas generando con todos los modelos de IA disponibles.',
    'pt-BR':
      'Renders com IA usam tokens de geração. Um plano pago renova seu saldo de tokens todo mês para você continuar gerando com todos os modelos de IA disponíveis.',
    fr: "Les rendus IA utilisent des jetons de génération. Un forfait payant renouvelle votre solde de jetons chaque mois pour continuer à générer avec tous les modèles d'IA disponibles."
  },
  surfaceGeoTitle: {
    en: 'Geospatial',
    es: 'Geoespacial',
    'pt-BR': 'Geoespacial',
    fr: 'Géospatial'
  },
  surfaceGeoSubtitle: {
    en: 'Real-world location · 3D map context',
    es: 'Ubicación real · contexto de mapa 3D',
    'pt-BR': 'Localização real · contexto de mapa 3D',
    fr: 'Lieu réel · contexte de carte 3D'
  },
  surfaceGeoHeadline: {
    en: 'Unlimited geospatial lookups',
    es: 'Búsquedas geoespaciales ilimitadas',
    'pt-BR': 'Consultas geoespaciais ilimitadas',
    fr: 'Recherches géospatiales illimitées'
  },
  surfaceGeoDesc: {
    en: 'Place your scene on a real-world map with 3D context of the surrounding environment. Pro unlocks unlimited location changes.',
    es: 'Sitúa tu escena en un mapa del mundo real con contexto 3D del entorno. Pro desbloquea cambios de ubicación ilimitados.',
    'pt-BR':
      'Posicione sua cena em um mapa do mundo real com contexto 3D do entorno. O Pro desbloqueia mudanças de localização ilimitadas.',
    fr: "Placez votre scène sur une carte du monde réel avec le contexte 3D de l'environnement. Pro débloque les changements de lieu illimités."
  },
  surfaceStorageTitle: {
    en: 'Cloud Storage',
    es: 'Almacenamiento en la nube',
    'pt-BR': 'Armazenamento na nuvem',
    fr: 'Stockage cloud'
  },
  surfaceStorageSubtitle: {
    en: 'Custom models & textures',
    es: 'Modelos y texturas personalizados',
    'pt-BR': 'Modelos e texturas personalizados',
    fr: 'Modèles et textures personnalisés'
  },
  surfaceStorageHeadline: {
    en: '50× more space for custom models',
    es: '50× más espacio para modelos personalizados',
    'pt-BR': '50× mais espaço para modelos personalizados',
    fr: "50× plus d'espace pour vos modèles personnalisés"
  },
  surfaceStorageDesc: {
    en: 'Your work is safe. The Free plan includes 100 MB of asset storage; Pro gives you 5 GB to grow into for custom models, textures, and splats.',
    es: 'Tu trabajo está a salvo. El plan Free incluye 100 MB de almacenamiento de recursos; Pro te da 5 GB para crecer con modelos personalizados, texturas y splats.',
    'pt-BR':
      'Seu trabalho está seguro. O plano Free inclui 100 MB de armazenamento de recursos; o Pro oferece 5 GB para crescer com modelos personalizados, texturas e splats.',
    fr: "Votre travail est en sécurité. Le forfait Free inclut 100 Mo de stockage d'actifs ; Pro vous donne 5 Go pour vos modèles personnalisés, textures et splats."
  },
  surfaceWatermarkTitle: {
    en: 'Snapshot',
    es: 'Instantánea',
    'pt-BR': 'Instantâneo',
    fr: 'Instantané'
  },
  surfaceWatermarkSubtitle: {
    en: '.jpg / .png · 2D image export',
    es: '.jpg / .png · exportación de imagen 2D',
    'pt-BR': '.jpg / .png · exportação de imagem 2D',
    fr: ".jpg / .png · export d'image 2D"
  },
  surfaceWatermarkHeadline: {
    en: 'Remove the watermark',
    es: 'Quita la marca de agua',
    'pt-BR': "Remova a marca d'água",
    fr: 'Supprimez le filigrane'
  },
  surfaceWatermarkDesc: {
    en: 'Share polished snapshots in client presentations, planning reports, and social posts.',
    es: 'Comparte instantáneas impecables en presentaciones para clientes, informes de planificación y redes sociales.',
    'pt-BR':
      'Compartilhe instantâneos impecáveis em apresentações para clientes, relatórios de planejamento e redes sociais.',
    fr: 'Partagez des instantanés soignés dans vos présentations client, rapports de planification et publications sociales.'
  },
  watermarkSecondaryCta: {
    en: 'Download now with watermark',
    es: 'Descargar ahora con marca de agua',
    'pt-BR': "Baixar agora com marca d'água",
    fr: 'Télécharger maintenant avec filigrane'
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
  },

  // Bollard Buddy — AR island strings (ProfileButton sign-in prompt + gallery
  // toasts). "Bollard Buddy" is the product name and is never translated.
  bbSignInMessage: {
    en: 'Sign in to save your scenes and access your gallery.',
    es: 'Inicia sesión para guardar tus escenas y acceder a tu galería.',
    'pt-BR': 'Faça login para salvar suas cenas e acessar sua galeria.',
    fr: 'Connectez-vous pour enregistrer vos scènes et accéder à votre galerie.'
  },
  bbPhotoSaved: {
    en: 'Photo saved to gallery!',
    es: '¡Foto guardada en la galería!',
    'pt-BR': 'Foto salva na galeria!',
    fr: 'Photo enregistrée dans la galerie !'
  },
  bbPhotoSaveFailed: {
    en: 'Failed to save photo',
    es: 'No se pudo guardar la foto',
    'pt-BR': 'Falha ao salvar a foto',
    fr: "Échec de l'enregistrement de la photo"
  },
  bbGeneratorSendFailed: {
    en: 'Failed to send photo to the AI generator',
    es: 'No se pudo enviar la foto al generador de IA',
    'pt-BR': 'Falha ao enviar a foto para o gerador de IA',
    fr: "Échec de l'envoi de la photo au générateur IA"
  },

  // Bollard Buddy — static AR page UI (object picker, CTAs). Object names label
  // the placeable street furniture; "SafeHit" is a brand name kept as-is.
  bbObjectBollard: {
    en: 'Bollard',
    es: 'Bolardo',
    'pt-BR': 'Balizador',
    fr: 'Borne'
  },
  bbObjectCone: { en: 'Cone', es: 'Cono', 'pt-BR': 'Cone', fr: 'Cône' },
  bbSelectObject: {
    en: 'Select Object',
    es: 'Seleccionar objeto',
    'pt-BR': 'Selecionar objeto',
    fr: 'Sélectionner un objet'
  },
  bbTapToPlace: {
    en: 'Tap on ground to place',
    es: 'Toca el suelo para colocar',
    'pt-BR': 'Toque no chão para posicionar',
    fr: 'Touchez le sol pour placer'
  },
  bbWebxrBeta: {
    en: 'WebXR Beta',
    es: 'WebXR Beta',
    'pt-BR': 'WebXR Beta',
    fr: 'WebXR Beta'
  },
  bbIosBest: {
    en: 'Best on iOS:',
    es: 'Mejor en iOS:',
    'pt-BR': 'Melhor no iOS:',
    fr: 'Meilleur sur iOS :'
  },
  bbIosGetApp: {
    en: 'Get the app',
    es: 'Descarga la app',
    'pt-BR': 'Baixe o app',
    fr: "Télécharger l'app"
  },
  bbDismiss: {
    en: 'Dismiss',
    es: 'Descartar',
    'pt-BR': 'Dispensar',
    fr: 'Ignorer'
  },
  bbDesktopBestOniPhone: {
    en: 'Bollard Buddy is best on iPhone.',
    es: 'Bollard Buddy funciona mejor en iPhone.',
    'pt-BR': 'O Bollard Buddy funciona melhor no iPhone.',
    fr: 'Bollard Buddy est meilleur sur iPhone.'
  },
  bbGetIosApp: {
    en: 'get the iOS app',
    es: 'descarga la app de iOS',
    'pt-BR': 'baixe o app para iOS',
    fr: "télécharger l'app iOS"
  },
  bbScanQr: {
    en: 'or scan the QR code above to use the web version.',
    es: 'o escanea el código QR de arriba para usar la versión web.',
    'pt-BR': 'ou escaneie o QR code acima para usar a versão web.',
    fr: 'ou scannez le code QR ci-dessus pour utiliser la version web.'
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
