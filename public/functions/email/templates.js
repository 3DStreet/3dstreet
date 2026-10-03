/**
 * Lifecycle email templates. Each export implements the template interface
 * sendLifecycleEmail expects: { getSubject, getHtmlBody, getTextBody }, all
 * receiving (userName, data, locale).
 *
 * Localization (#1841): every template carries per-locale copy for the same
 * locales the editor UI ships (en / es / pt-BR / fr — see
 * src/shared/i18n/locales.js). The send service resolves the recipient's
 * locale (public/functions/email/locale.js) and passes it as the third
 * argument; unknown locales fall back to English. Translations are
 * hand-written and live here in-repo so they're reviewable and versioned —
 * when editing copy, edit ALL locales of that template. A missing key falls
 * back to English for just that key (see defineTemplate), so an incomplete
 * translation degrades one field to English rather than interpolating a
 * literal `undefined` into a live email — but still fill in every locale so
 * recipients get fully translated copy.
 *
 * Broadcast-stream templates must NOT include their own unsubscribe link —
 * the send service appends the Postmark `{{{ pm:unsubscribe_url }}}` footer
 * (localized) to everything sent on a broadcast stream.
 */

const { DEFAULT_EMAIL_LOCALE, normalizeEmailLocale } = require('./locale.js');

const APP_BASE = 'https://3dstreet.app';

const utm = (campaign, content) =>
  `utm_source=email&utm_medium=lifecycle&utm_campaign=${campaign}&utm_content=${content}`;

// Per-locale chrome shared by every email: greeting (userName may be null
// when the Auth record has no displayName) and signature.
const CHROME = {
  en: {
    greeting: (name) => (name ? `Hi ${name},` : 'Hi there,'),
    team: 'The 3DStreet Team'
  },
  es: {
    greeting: (name) => (name ? `¡Hola, ${name}!` : '¡Hola!'),
    team: 'El equipo de 3DStreet'
  },
  'pt-BR': {
    greeting: (name) => (name ? `Olá, ${name}!` : 'Olá!'),
    team: 'A equipe do 3DStreet'
  },
  fr: {
    greeting: (name) => (name ? `Bonjour ${name},` : 'Bonjour,'),
    team: `L'équipe 3DStreet`
  }
};

const chromeFor = (locale) => CHROME[locale] || CHROME[DEFAULT_EMAIL_LOCALE];

// Shared chrome matching the original scheduledEmails.js templates (logo
// header, indigo CTA, muted signature).
const htmlLayout = (
  locale,
  userName,
  bodyHtml,
  { ctaUrl, ctaLabel, footnote }
) => `<!DOCTYPE html>
<html lang="${locale || DEFAULT_EMAIL_LOCALE}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">${chromeFor(locale).greeting(userName)}</h2>

${bodyHtml}
${
  ctaUrl
    ? `
  <div style="text-align: center; margin: 30px 0;">
    <a href="${ctaUrl}" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">${ctaLabel}</a>
  </div>`
    : ''
}
  <p style="color: #666;">${chromeFor(locale).team}<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>
${
  footnote
    ? `
  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    ${footnote}
  </p>`
    : ''
}
</body>
</html>`;

const textLayout = (
  locale,
  userName,
  bodyText,
  { ctaUrl, ctaLabel, footnote }
) => `${chromeFor(locale).greeting(userName)}

${bodyText}
${ctaUrl ? `\n${ctaLabel}: ${ctaUrl}\n` : ''}
${chromeFor(locale).team}
https://3dstreet.com${footnote ? `\n\n---\n${footnote.replace(/<[^>]+>/g, '')}` : ''}`;

/**
 * Build a lifecycle template from per-locale copy.
 *
 * `copy[locale]` holds { subject, bodyHtml, bodyText, ctaLabel, footnote,
 * footnoteText? } — each entry a string or a function of `data`. `footnote`
 * is the HTML footnote; `footnoteText` overrides the plain-text variant when
 * tag-stripping the HTML would lose information (e.g. a link URL).
 * `ctaUrl(content)` builds the (locale-independent) CTA link, receiving the
 * utm_content value ('cta_button' for HTML, 'cta_link' for text).
 */
const defineTemplate = (copy, { ctaUrl = null } = {}) => {
  const fallback = copy[DEFAULT_EMAIL_LOCALE];
  // Per-key English fallback: a locale entry that omits a key (an incomplete
  // translation) inherits just that key from English, so a partial edit can
  // never interpolate a literal `undefined` into a live email. A whole
  // missing locale still resolves to the full English entry.
  const pick = (locale) => {
    const entry = copy[locale];
    return entry && entry !== fallback ? { ...fallback, ...entry } : fallback;
  };
  const resolve = (value, data) =>
    typeof value === 'function' ? value(data) : value;
  return {
    getSubject: (userName, data = {}, locale) =>
      resolve(pick(normalizeEmailLocale(locale)).subject, data),
    // Normalize the locale up front so the copy, the chrome, and the `lang`
    // attribute all agree: an unknown-but-truthy tag (e.g. 'tlh') renders in
    // English AND is labeled lang="en", never lang="tlh".
    getHtmlBody: (userName, data = {}, locale) => {
      const loc = normalizeEmailLocale(locale);
      const c = pick(loc);
      return htmlLayout(loc, userName, resolve(c.bodyHtml, data), {
        ctaUrl: ctaUrl ? ctaUrl('cta_button') : null,
        ctaLabel: resolve(c.ctaLabel, data),
        footnote: resolve(c.footnote, data)
      });
    },
    getTextBody: (userName, data = {}, locale) => {
      const loc = normalizeEmailLocale(locale);
      const c = pick(loc);
      return textLayout(loc, userName, resolve(c.bodyText, data), {
        ctaUrl: ctaUrl ? ctaUrl('cta_link') : null,
        ctaLabel: resolve(c.ctaLabel, data),
        footnote: resolve(c.footnoteText ?? c.footnote, data)
      });
    }
  };
};

// ---------------------------------------------------------------------------
// Transactional (outbound stream)
// ---------------------------------------------------------------------------

const welcome = defineTemplate(
  {
    en: {
      subject: 'Welcome to 3DStreet!',
      bodyHtml: `  <p>Welcome to <strong>3DStreet</strong>, the browser-based tool for designing and sharing 3D street scenes.</p>

  <p>A few ways to get going:</p>

  <ul style="padding-left: 20px;">
    <li><strong>Place your street in the real world:</strong> your new account includes 3 free geo tokens for adding Google 3D Map Tiles to your scene</li>
    <li><strong>Render high quality visuals:</strong> use the Snapshot &amp; Render or AI Generator tools to create photorealistic or stylized renderings &ndash; your new account includes free AI Rendering tokens to try this, no credit card required</li>
    <li><strong>Start from scratch and add built-in 3D models and streets:</strong> create a blank scene and click (+) to add streets, vehicles, people, greening, and more from our included asset library</li>
    <li><strong>Import your own creations:</strong> drag-and-drop to upload your own images, 3D models, or Gaussian splat 3D scans to mix with your scene</li>
  </ul>`,
      bodyText: `Welcome to 3DStreet, the browser-based tool for designing and sharing 3D street scenes.

A few ways to get going:

- Place your street in the real world: your new account includes 3 free geo tokens for adding Google 3D Map Tiles to your scene
- Render high quality visuals: use the Snapshot & Render or AI Generator tools to create photorealistic or stylized renderings - your new account includes free AI Rendering tokens to try this, no credit card required
- Start from scratch and add built-in 3D models and streets: create a blank scene and click (+) to add streets, vehicles, people, greening, and more from our included asset library
- Import your own creations: drag-and-drop to upload your own images, 3D models, or Gaussian splat 3D scans to mix with your scene`,
      ctaLabel: 'Start designing',
      footnote:
        'You received this email because you created an account on 3DStreet. This message is only sent once. Questions? Just reply to this email.'
    },
    es: {
      subject: '¡Te damos la bienvenida a 3DStreet!',
      bodyHtml: `  <p>Te damos la bienvenida a <strong>3DStreet</strong>, la herramienta en el navegador para diseñar y compartir escenas de calles en 3D.</p>

  <p>Algunas formas de empezar:</p>

  <ul style="padding-left: 20px;">
    <li><strong>Coloca tu calle en el mundo real:</strong> tu nueva cuenta incluye 3 tokens geo gratuitos para añadir Google 3D Map Tiles a tu escena</li>
    <li><strong>Crea visualizaciones de alta calidad:</strong> usa las herramientas Snapshot &amp; Render o el Generador de IA para crear renders fotorrealistas o estilizados &ndash; tu nueva cuenta incluye tokens gratuitos de renderizado con IA para probarlo, sin necesidad de tarjeta de crédito</li>
    <li><strong>Empieza desde cero y añade calles y modelos 3D integrados:</strong> crea una escena en blanco y haz clic en (+) para añadir calles, vehículos, personas, vegetación y mucho más desde nuestra biblioteca de recursos incluida</li>
    <li><strong>Importa tus propias creaciones:</strong> arrastra y suelta para subir tus propias imágenes, modelos 3D o escaneos 3D de Gaussian splats y combinarlos con tu escena</li>
  </ul>`,
      bodyText: `Te damos la bienvenida a 3DStreet, la herramienta en el navegador para diseñar y compartir escenas de calles en 3D.

Algunas formas de empezar:

- Coloca tu calle en el mundo real: tu nueva cuenta incluye 3 tokens geo gratuitos para añadir Google 3D Map Tiles a tu escena
- Crea visualizaciones de alta calidad: usa las herramientas Snapshot & Render o el Generador de IA para crear renders fotorrealistas o estilizados - tu nueva cuenta incluye tokens gratuitos de renderizado con IA para probarlo, sin necesidad de tarjeta de crédito
- Empieza desde cero y añade calles y modelos 3D integrados: crea una escena en blanco y haz clic en (+) para añadir calles, vehículos, personas, vegetación y mucho más desde nuestra biblioteca de recursos incluida
- Importa tus propias creaciones: arrastra y suelta para subir tus propias imágenes, modelos 3D o escaneos 3D de Gaussian splats y combinarlos con tu escena`,
      ctaLabel: 'Empieza a diseñar',
      footnote:
        'Recibes este correo porque creaste una cuenta en 3DStreet. Este mensaje se envía una sola vez. ¿Tienes preguntas? Simplemente responde a este correo.'
    },
    'pt-BR': {
      subject: 'Boas-vindas ao 3DStreet!',
      bodyHtml: `  <p>Boas-vindas ao <strong>3DStreet</strong>, a ferramenta no navegador para criar e compartilhar cenas de rua em 3D.</p>

  <p>Algumas formas de começar:</p>

  <ul style="padding-left: 20px;">
    <li><strong>Coloque sua rua no mundo real:</strong> sua nova conta inclui 3 tokens geo gratuitos para adicionar o Google 3D Map Tiles à sua cena</li>
    <li><strong>Crie visualizações de alta qualidade:</strong> use as ferramentas Snapshot &amp; Render ou o Gerador de IA para criar renderizações fotorrealistas ou estilizadas &ndash; sua nova conta inclui tokens gratuitos de renderização com IA para experimentar, sem precisar de cartão de crédito</li>
    <li><strong>Comece do zero e adicione ruas e modelos 3D integrados:</strong> crie uma cena em branco e clique em (+) para adicionar ruas, veículos, pessoas, vegetação e muito mais da nossa biblioteca de recursos incluída</li>
    <li><strong>Importe suas próprias criações:</strong> arraste e solte para enviar suas próprias imagens, modelos 3D ou escaneamentos 3D de Gaussian splats e combiná-los com sua cena</li>
  </ul>`,
      bodyText: `Boas-vindas ao 3DStreet, a ferramenta no navegador para criar e compartilhar cenas de rua em 3D.

Algumas formas de começar:

- Coloque sua rua no mundo real: sua nova conta inclui 3 tokens geo gratuitos para adicionar o Google 3D Map Tiles à sua cena
- Crie visualizações de alta qualidade: use as ferramentas Snapshot & Render ou o Gerador de IA para criar renderizações fotorrealistas ou estilizadas - sua nova conta inclui tokens gratuitos de renderização com IA para experimentar, sem precisar de cartão de crédito
- Comece do zero e adicione ruas e modelos 3D integrados: crie uma cena em branco e clique em (+) para adicionar ruas, veículos, pessoas, vegetação e muito mais da nossa biblioteca de recursos incluída
- Importe suas próprias criações: arraste e solte para enviar suas próprias imagens, modelos 3D ou escaneamentos 3D de Gaussian splats e combiná-los com sua cena`,
      ctaLabel: 'Comece a projetar',
      footnote:
        'Você recebeu este e-mail porque criou uma conta no 3DStreet. Esta mensagem é enviada uma única vez. Dúvidas? É só responder a este e-mail.'
    },
    fr: {
      subject: 'Bienvenue sur 3DStreet !',
      bodyHtml: `  <p>Bienvenue sur <strong>3DStreet</strong>, l'outil dans le navigateur pour concevoir et partager des scènes de rue en 3D.</p>

  <p>Quelques pistes pour bien démarrer :</p>

  <ul style="padding-left: 20px;">
    <li><strong>Placez votre rue dans le monde réel :</strong> votre nouveau compte inclut 3 jetons géo gratuits pour ajouter les tuiles Google 3D Map Tiles à votre scène</li>
    <li><strong>Produisez des visuels de haute qualité :</strong> utilisez les outils Snapshot &amp; Render ou le générateur d'IA pour créer des rendus photoréalistes ou stylisés &ndash; votre nouveau compte inclut des jetons de rendu IA gratuits pour essayer, sans carte bancaire</li>
    <li><strong>Partez de zéro et ajoutez des rues et des modèles 3D intégrés :</strong> créez une scène vierge et cliquez sur (+) pour ajouter des rues, des véhicules, des personnes, de la végétation et plus encore depuis notre bibliothèque d'assets incluse</li>
    <li><strong>Importez vos propres créations :</strong> glissez-déposez vos images, modèles 3D ou scans 3D en Gaussian splats pour les combiner à votre scène</li>
  </ul>`,
      bodyText: `Bienvenue sur 3DStreet, l'outil dans le navigateur pour concevoir et partager des scènes de rue en 3D.

Quelques pistes pour bien démarrer :

- Placez votre rue dans le monde réel : votre nouveau compte inclut 3 jetons géo gratuits pour ajouter les tuiles Google 3D Map Tiles à votre scène
- Produisez des visuels de haute qualité : utilisez les outils Snapshot & Render ou le générateur d'IA pour créer des rendus photoréalistes ou stylisés - votre nouveau compte inclut des jetons de rendu IA gratuits pour essayer, sans carte bancaire
- Partez de zéro et ajoutez des rues et des modèles 3D intégrés : créez une scène vierge et cliquez sur (+) pour ajouter des rues, des véhicules, des personnes, de la végétation et plus encore depuis notre bibliothèque d'assets incluse
- Importez vos propres créations : glissez-déposez vos images, modèles 3D ou scans 3D en Gaussian splats pour les combiner à votre scène`,
      ctaLabel: 'Commencer à concevoir',
      footnote:
        "Vous recevez cet e-mail parce que vous avez créé un compte sur 3DStreet. Ce message n'est envoyé qu'une seule fois. Des questions ? Répondez simplement à cet e-mail."
    }
  },
  { ctaUrl: (content) => `${APP_BASE}/?${utm('welcome', content)}` }
);

// data: { planTier: 'PRO' | 'MAX' }
const tierName = (data = {}) => (data.planTier === 'MAX' ? 'Max' : 'Pro');

const postUpgradeWelcome = defineTemplate(
  {
    en: {
      subject: (data) =>
        `You're on 3DStreet ${tierName(data)}! Here's what's unlocked`,
      bodyHtml: (data) => `  <p>Thanks for upgrading to <strong>3DStreet ${tierName(data)}</strong>! Your account now includes:</p>

  <ul style="padding-left: 20px;">
    <li>Watermark-free snapshots and HD renders</li>
    <li>Unlimited geospatial maps &amp; location changes</li>
    <li>An allowance of AI generation tokens topped up each month</li>
    <li>3D Model glTF Export</li>
    <li>Larger asset storage allowance for uploading custom 3D models, scans (splat or mesh), and images</li>
  </ul>

  <p>Everything is already active on your account. Just open the editor.</p>`,
      bodyText: (data) => `Thanks for upgrading to 3DStreet ${tierName(data)}! Your account now includes:

- Watermark-free snapshots and HD renders
- Unlimited geospatial maps & location changes
- An allowance of AI generation tokens topped up each month
- 3D Model glTF Export
- Larger asset storage allowance for uploading custom 3D models, scans (splat or mesh), and images

Everything is already active on your account. Just open the editor.`,
      ctaLabel: 'Open 3DStreet',
      footnote:
        'You received this email because you purchased a 3DStreet subscription. Manage your subscription anytime from your profile in the app. Questions? Just reply to this email.'
    },
    es: {
      subject: (data) =>
        `¡Ya tienes 3DStreet ${tierName(data)}! Esto es lo que has desbloqueado`,
      bodyHtml: (data) => `  <p>¡Gracias por pasarte a <strong>3DStreet ${tierName(data)}</strong>! Tu cuenta ahora incluye:</p>

  <ul style="padding-left: 20px;">
    <li>Capturas y renders en HD sin marca de agua</li>
    <li>Mapas geoespaciales y cambios de ubicación ilimitados</li>
    <li>Una asignación de tokens de generación con IA que se recarga cada mes</li>
    <li>Exportación de modelos 3D en glTF</li>
    <li>Mayor espacio de almacenamiento para subir tus propios modelos 3D, escaneos (splat o malla) e imágenes</li>
  </ul>

  <p>Todo está ya activo en tu cuenta. Solo tienes que abrir el editor.</p>`,
      bodyText: (data) => `¡Gracias por pasarte a 3DStreet ${tierName(data)}! Tu cuenta ahora incluye:

- Capturas y renders en HD sin marca de agua
- Mapas geoespaciales y cambios de ubicación ilimitados
- Una asignación de tokens de generación con IA que se recarga cada mes
- Exportación de modelos 3D en glTF
- Mayor espacio de almacenamiento para subir tus propios modelos 3D, escaneos (splat o malla) e imágenes

Todo está ya activo en tu cuenta. Solo tienes que abrir el editor.`,
      ctaLabel: 'Abrir 3DStreet',
      footnote:
        'Recibes este correo porque compraste una suscripción de 3DStreet. Gestiona tu suscripción en cualquier momento desde tu perfil en la aplicación. ¿Tienes preguntas? Simplemente responde a este correo.'
    },
    'pt-BR': {
      subject: (data) =>
        `Você agora tem o 3DStreet ${tierName(data)}! Veja o que foi desbloqueado`,
      bodyHtml: (data) => `  <p>Agradecemos por assinar o <strong>3DStreet ${tierName(data)}</strong>! Sua conta agora inclui:</p>

  <ul style="padding-left: 20px;">
    <li>Capturas e renderizações em HD sem marca d'água</li>
    <li>Mapas geoespaciais e trocas de localização ilimitados</li>
    <li>Uma cota de tokens de geração com IA recarregada todo mês</li>
    <li>Exportação de modelos 3D em glTF</li>
    <li>Mais espaço de armazenamento para enviar seus próprios modelos 3D, escaneamentos (splat ou malha) e imagens</li>
  </ul>

  <p>Tudo já está ativo na sua conta. É só abrir o editor.</p>`,
      bodyText: (data) => `Agradecemos por assinar o 3DStreet ${tierName(data)}! Sua conta agora inclui:

- Capturas e renderizações em HD sem marca d'água
- Mapas geoespaciais e trocas de localização ilimitados
- Uma cota de tokens de geração com IA recarregada todo mês
- Exportação de modelos 3D em glTF
- Mais espaço de armazenamento para enviar seus próprios modelos 3D, escaneamentos (splat ou malha) e imagens

Tudo já está ativo na sua conta. É só abrir o editor.`,
      ctaLabel: 'Abrir o 3DStreet',
      footnote:
        'Você recebeu este e-mail porque comprou uma assinatura do 3DStreet. Gerencie sua assinatura a qualquer momento pelo seu perfil no aplicativo. Dúvidas? É só responder a este e-mail.'
    },
    fr: {
      subject: (data) =>
        `Vous êtes sur 3DStreet ${tierName(data)} ! Voici ce qui est débloqué`,
      bodyHtml: (data) => `  <p>Merci d'avoir souscrit à <strong>3DStreet ${tierName(data)}</strong> ! Votre compte inclut désormais :</p>

  <ul style="padding-left: 20px;">
    <li>Des instantanés et des rendus HD sans filigrane</li>
    <li>Cartes géospatiales et changements de lieu illimités</li>
    <li>Une réserve de jetons de génération IA rechargée chaque mois</li>
    <li>L'export de modèles 3D au format glTF</li>
    <li>Un espace de stockage élargi pour importer vos propres modèles 3D, scans (splat ou mesh) et images</li>
  </ul>

  <p>Tout est déjà actif sur votre compte. Il ne vous reste qu'à ouvrir l'éditeur.</p>`,
      bodyText: (data) => `Merci d'avoir souscrit à 3DStreet ${tierName(data)} ! Votre compte inclut désormais :

- Des instantanés et des rendus HD sans filigrane
- Cartes géospatiales et changements de lieu illimités
- Une réserve de jetons de génération IA rechargée chaque mois
- L'export de modèles 3D au format glTF
- Un espace de stockage élargi pour importer vos propres modèles 3D, scans (splat ou mesh) et images

Tout est déjà actif sur votre compte. Il ne vous reste qu'à ouvrir l'éditeur.`,
      ctaLabel: 'Ouvrir 3DStreet',
      footnote:
        "Vous recevez cet e-mail parce que vous avez souscrit un abonnement 3DStreet. Gérez votre abonnement à tout moment depuis votre profil dans l'application. Des questions ? Répondez simplement à cet e-mail."
    }
  },
  { ctaUrl: (content) => `${APP_BASE}/?${utm('post_upgrade', content)}` }
);

const failedPayment = defineTemplate(
  {
    en: {
      subject: 'Action needed: payment issue with your 3DStreet subscription',
      bodyHtml: `  <p>We couldn't process the latest payment for your 3DStreet subscription. This usually means a card expired or was declined.</p>

  <p>To keep your Pro features active, please update your payment method. Open 3DStreet, click your profile picture, and choose <strong>Manage subscription</strong> to reach the secure billing portal.</p>

  <p>Stripe will retry the charge automatically over the next few days, so if you've already fixed it, you're all set.</p>`,
      bodyText: `We couldn't process the latest payment for your 3DStreet subscription. This usually means a card expired or was declined.

To keep your Pro features active, please update your payment method. Open 3DStreet, click your profile picture, and choose "Manage subscription" to reach the secure billing portal.

Stripe will retry the charge automatically over the next few days, so if you've already fixed it, you're all set.`,
      ctaLabel: 'Update payment method',
      footnote:
        "You received this email because a subscription payment didn't go through. If you believe this is a mistake, reply to this email and we'll sort it out."
    },
    es: {
      subject:
        'Acción necesaria: problema con el pago de tu suscripción de 3DStreet',
      bodyHtml: `  <p>No pudimos procesar el último pago de tu suscripción de 3DStreet. Esto suele deberse a una tarjeta vencida o rechazada.</p>

  <p>Para mantener activas tus funciones Pro, actualiza tu método de pago. Abre 3DStreet, haz clic en tu foto de perfil y elige <strong>Gestionar suscripción</strong> para acceder al portal de facturación seguro.</p>

  <p>Stripe reintentará el cobro automáticamente durante los próximos días, así que si ya lo solucionaste, no tienes que hacer nada más.</p>`,
      bodyText: `No pudimos procesar el último pago de tu suscripción de 3DStreet. Esto suele deberse a una tarjeta vencida o rechazada.

Para mantener activas tus funciones Pro, actualiza tu método de pago. Abre 3DStreet, haz clic en tu foto de perfil y elige "Gestionar suscripción" para acceder al portal de facturación seguro.

Stripe reintentará el cobro automáticamente durante los próximos días, así que si ya lo solucionaste, no tienes que hacer nada más.`,
      ctaLabel: 'Actualizar método de pago',
      footnote:
        'Recibes este correo porque un pago de tu suscripción no se pudo procesar. Si crees que se trata de un error, responde a este correo y lo resolveremos.'
    },
    'pt-BR': {
      subject:
        'Ação necessária: problema com o pagamento da sua assinatura do 3DStreet',
      bodyHtml: `  <p>Não conseguimos processar o último pagamento da sua assinatura do 3DStreet. Isso geralmente acontece quando um cartão expirou ou foi recusado.</p>

  <p>Para manter seus recursos Pro ativos, atualize sua forma de pagamento. Abra o 3DStreet, clique na sua foto de perfil e escolha <strong>Gerenciar assinatura</strong> para acessar o portal de cobrança seguro.</p>

  <p>O Stripe tentará realizar a cobrança novamente nos próximos dias; se você já resolveu, não precisa fazer mais nada.</p>`,
      bodyText: `Não conseguimos processar o último pagamento da sua assinatura do 3DStreet. Isso geralmente acontece quando um cartão expirou ou foi recusado.

Para manter seus recursos Pro ativos, atualize sua forma de pagamento. Abra o 3DStreet, clique na sua foto de perfil e escolha "Gerenciar assinatura" para acessar o portal de cobrança seguro.

O Stripe tentará realizar a cobrança novamente nos próximos dias; se você já resolveu, não precisa fazer mais nada.`,
      ctaLabel: 'Atualizar forma de pagamento',
      footnote:
        'Você recebeu este e-mail porque um pagamento da assinatura não foi concluído. Se você acha que isso é um engano, responda a este e-mail e resolveremos.'
    },
    fr: {
      subject:
        'Action requise : problème de paiement de votre abonnement 3DStreet',
      bodyHtml: `  <p>Nous n'avons pas pu traiter le dernier paiement de votre abonnement 3DStreet. En général, cela signifie qu'une carte a expiré ou a été refusée.</p>

  <p>Pour garder vos fonctionnalités Pro actives, mettez à jour votre moyen de paiement. Ouvrez 3DStreet, cliquez sur votre photo de profil et choisissez <strong>Gérer l'abonnement</strong> pour accéder au portail de facturation sécurisé.</p>

  <p>Stripe retentera automatiquement le prélèvement dans les prochains jours ; si vous avez déjà corrigé le problème, vous n'avez rien d'autre à faire.</p>`,
      bodyText: `Nous n'avons pas pu traiter le dernier paiement de votre abonnement 3DStreet. En général, cela signifie qu'une carte a expiré ou a été refusée.

Pour garder vos fonctionnalités Pro actives, mettez à jour votre moyen de paiement. Ouvrez 3DStreet, cliquez sur votre photo de profil et choisissez « Gérer l'abonnement » pour accéder au portail de facturation sécurisé.

Stripe retentera automatiquement le prélèvement dans les prochains jours ; si vous avez déjà corrigé le problème, vous n'avez rien d'autre à faire.`,
      ctaLabel: 'Mettre à jour le moyen de paiement',
      footnote:
        "Vous recevez cet e-mail parce qu'un paiement d'abonnement n'a pas abouti. Si vous pensez qu'il s'agit d'une erreur, répondez à cet e-mail et nous réglerons cela."
    }
  },
  { ctaUrl: (content) => `${APP_BASE}/?${utm('failed_payment', content)}` }
);

// ---------------------------------------------------------------------------
// Conversion (broadcast stream — unsubscribe footer appended by the service)
// ---------------------------------------------------------------------------

const checkoutAbandoned1h = defineTemplate(
  {
    en: {
      subject: 'Your 3DStreet Pro checkout is waiting',
      bodyHtml: `  <p>Looks like you started upgrading to <strong>3DStreet Pro</strong> but didn't finish checking out. Your cart is still there whenever you're ready.</p>

  <p>Pro unlocks watermark-free downloads, unlimited geospatial maps, HD renders, custom model imports, and a monthly allowance of AI tokens.</p>`,
      bodyText: `Looks like you started upgrading to 3DStreet Pro but didn't finish checking out. Your cart is still there whenever you're ready.

Pro unlocks watermark-free downloads, unlimited geospatial maps, HD renders, custom model imports, and a monthly allowance of AI tokens.`,
      ctaLabel: 'Finish upgrading',
      footnote: null
    },
    es: {
      subject: 'Tu compra de 3DStreet Pro te está esperando',
      bodyHtml: `  <p>Parece que empezaste a actualizar a <strong>3DStreet Pro</strong> pero no terminaste la compra. Tu carrito sigue ahí para cuando quieras.</p>

  <p>Pro desbloquea descargas sin marca de agua, mapas geoespaciales ilimitados, renders en HD, importación de modelos personalizados y una asignación mensual de tokens de IA.</p>`,
      bodyText: `Parece que empezaste a actualizar a 3DStreet Pro pero no terminaste la compra. Tu carrito sigue ahí para cuando quieras.

Pro desbloquea descargas sin marca de agua, mapas geoespaciales ilimitados, renders en HD, importación de modelos personalizados y una asignación mensual de tokens de IA.`,
      ctaLabel: 'Terminar la actualización',
      footnote: null
    },
    'pt-BR': {
      subject: 'Sua compra do 3DStreet Pro está esperando por você',
      bodyHtml: `  <p>Parece que você começou a assinar o <strong>3DStreet Pro</strong>, mas não concluiu a compra. Seu carrinho continua lá para quando você quiser.</p>

  <p>O Pro desbloqueia downloads sem marca d'água, mapas geoespaciais ilimitados, renderizações em HD, importação de modelos personalizados e uma cota mensal de tokens de IA.</p>`,
      bodyText: `Parece que você começou a assinar o 3DStreet Pro, mas não concluiu a compra. Seu carrinho continua lá para quando você quiser.

O Pro desbloqueia downloads sem marca d'água, mapas geoespaciais ilimitados, renderizações em HD, importação de modelos personalizados e uma cota mensal de tokens de IA.`,
      ctaLabel: 'Concluir a assinatura',
      footnote: null
    },
    fr: {
      subject: 'Votre commande 3DStreet Pro vous attend',
      bodyHtml: `  <p>On dirait que vous avez commencé à passer à <strong>3DStreet Pro</strong> sans finaliser votre commande. Votre panier vous attend, quand vous voulez.</p>

  <p>Pro débloque les téléchargements sans filigrane, les cartes géospatiales illimitées, les rendus HD, l'import de modèles personnalisés et une réserve mensuelle de jetons IA.</p>`,
      bodyText: `On dirait que vous avez commencé à passer à 3DStreet Pro sans finaliser votre commande. Votre panier vous attend, quand vous voulez.

Pro débloque les téléchargements sans filigrane, les cartes géospatiales illimitées, les rendus HD, l'import de modèles personnalisés et une réserve mensuelle de jetons IA.`,
      ctaLabel: 'Finaliser la mise à niveau',
      footnote: null
    }
  },
  {
    ctaUrl: (content) =>
      `${APP_BASE}/?${utm('checkout_abandoned_1h', content)}#payment`
  }
);

const checkoutAbandoned72h = defineTemplate(
  {
    en: {
      subject: 'Still thinking about 3DStreet Pro?',
      bodyHtml: `  <p>A few days ago you started a <strong>3DStreet Pro</strong> checkout. No pressure. But if something held you back, we'd genuinely like to know, and a reply to this email goes straight to us.</p>

  <p>If you're ready, picking up where you left off takes about a minute.</p>`,
      bodyText: `A few days ago you started a 3DStreet Pro checkout. No pressure. But if something held you back, we'd genuinely like to know, and a reply to this email goes straight to us.

If you're ready, picking up where you left off takes about a minute.`,
      ctaLabel: 'Resume checkout',
      footnote: null
    },
    es: {
      subject: '¿Sigues pensando en 3DStreet Pro?',
      bodyHtml: `  <p>Hace unos días empezaste una compra de <strong>3DStreet Pro</strong>. Sin presión. Pero si algo te frenó, nos encantaría saberlo de verdad: una respuesta a este correo nos llega directamente.</p>

  <p>Si ya lo tienes claro, retomar donde lo dejaste toma alrededor de un minuto.</p>`,
      bodyText: `Hace unos días empezaste una compra de 3DStreet Pro. Sin presión. Pero si algo te frenó, nos encantaría saberlo de verdad: una respuesta a este correo nos llega directamente.

Si ya lo tienes claro, retomar donde lo dejaste toma alrededor de un minuto.`,
      ctaLabel: 'Reanudar la compra',
      footnote: null
    },
    'pt-BR': {
      subject: 'Ainda pensando no 3DStreet Pro?',
      bodyHtml: `  <p>Há alguns dias você começou uma compra do <strong>3DStreet Pro</strong>. Sem pressão. Mas se algo impediu, adoraríamos saber: basta responder a este e-mail e sua mensagem chega direto para a gente.</p>

  <p>Se quiser continuar, retomar de onde parou leva cerca de um minuto.</p>`,
      bodyText: `Há alguns dias você começou uma compra do 3DStreet Pro. Sem pressão. Mas se algo impediu, adoraríamos saber: basta responder a este e-mail e sua mensagem chega direto para a gente.

Se quiser continuar, retomar de onde parou leva cerca de um minuto.`,
      ctaLabel: 'Retomar a compra',
      footnote: null
    },
    fr: {
      subject: 'Vous hésitez encore pour 3DStreet Pro ?',
      bodyHtml: `  <p>Il y a quelques jours, vous avez commencé une commande <strong>3DStreet Pro</strong>. Aucune pression. Mais si quelque chose vous a retenu, cela nous intéresse sincèrement &mdash; une réponse à cet e-mail nous parvient directement.</p>

  <p>Quand vous le souhaitez, reprendre là où vous en étiez prend à peine une minute.</p>`,
      bodyText: `Il y a quelques jours, vous avez commencé une commande 3DStreet Pro. Aucune pression. Mais si quelque chose vous a retenu, cela nous intéresse sincèrement - une réponse à cet e-mail nous parvient directement.

Quand vous le souhaitez, reprendre là où vous en étiez prend à peine une minute.`,
      ctaLabel: 'Reprendre la commande',
      footnote: null
    }
  },
  {
    ctaUrl: (content) =>
      `${APP_BASE}/?${utm('checkout_abandoned_72h', content)}#payment`
  }
);

const pricingPageNudge = defineTemplate(
  {
    en: {
      subject: 'Questions about 3DStreet Pro?',
      bodyHtml: `  <p>You recently checked out the <strong>3DStreet Pro</strong> plans. If anything was unclear about pricing, features, or whether it fits your project, just reply to this email and a human will answer.</p>

  <p>The short version: Pro removes watermarks, makes geospatial maps unlimited, and adds HD renders, custom imports, and monthly AI tokens.</p>`,
      bodyText: `You recently checked out the 3DStreet Pro plans. If anything was unclear about pricing, features, or whether it fits your project, just reply to this email and a human will answer.

The short version: Pro removes watermarks, makes geospatial maps unlimited, and adds HD renders, custom imports, and monthly AI tokens.`,
      ctaLabel: 'See plans',
      footnote: null
    },
    es: {
      subject: '¿Tienes preguntas sobre 3DStreet Pro?',
      bodyHtml: `  <p>Hace poco estuviste viendo los planes de <strong>3DStreet Pro</strong>. Si algo no quedó claro sobre los precios, las funciones o si encaja con tu proyecto, responde a este correo y una persona te contestará.</p>

  <p>En resumen: Pro elimina las marcas de agua, hace ilimitados los mapas geoespaciales y añade renders en HD, importaciones personalizadas y tokens de IA mensuales.</p>`,
      bodyText: `Hace poco estuviste viendo los planes de 3DStreet Pro. Si algo no quedó claro sobre los precios, las funciones o si encaja con tu proyecto, responde a este correo y una persona te contestará.

En resumen: Pro elimina las marcas de agua, hace ilimitados los mapas geoespaciales y añade renders en HD, importaciones personalizadas y tokens de IA mensuales.`,
      ctaLabel: 'Ver planes',
      footnote: null
    },
    'pt-BR': {
      subject: 'Dúvidas sobre o 3DStreet Pro?',
      bodyHtml: `  <p>Você deu uma olhada recentemente nos planos do <strong>3DStreet Pro</strong>. Se algo não ficou claro sobre preços, recursos ou se ele atende ao seu projeto, responda a este e-mail e uma pessoa de verdade vai responder.</p>

  <p>Resumindo: o Pro remove as marcas d'água, torna os mapas geoespaciais ilimitados e adiciona renderizações em HD, importações personalizadas e tokens mensais de IA.</p>`,
      bodyText: `Você deu uma olhada recentemente nos planos do 3DStreet Pro. Se algo não ficou claro sobre preços, recursos ou se ele atende ao seu projeto, responda a este e-mail e uma pessoa de verdade vai responder.

Resumindo: o Pro remove as marcas d'água, torna os mapas geoespaciais ilimitados e adiciona renderizações em HD, importações personalizadas e tokens mensais de IA.`,
      ctaLabel: 'Ver planos',
      footnote: null
    },
    fr: {
      subject: 'Des questions sur 3DStreet Pro ?',
      bodyHtml: `  <p>Vous avez récemment consulté les offres <strong>3DStreet Pro</strong>. Si quelque chose n'était pas clair &mdash; tarifs, fonctionnalités, ou adéquation avec votre projet &mdash; répondez simplement à cet e-mail et un humain vous répondra.</p>

  <p>En bref : Pro supprime les filigranes, rend les cartes géospatiales illimitées et ajoute les rendus HD, les imports personnalisés et des jetons IA mensuels.</p>`,
      bodyText: `Vous avez récemment consulté les offres 3DStreet Pro. Si quelque chose n'était pas clair - tarifs, fonctionnalités, ou adéquation avec votre projet - répondez simplement à cet e-mail et un humain vous répondra.

En bref : Pro supprime les filigranes, rend les cartes géospatiales illimitées et ajoute les rendus HD, les imports personnalisés et des jetons IA mensuels.`,
      ctaLabel: 'Voir les offres',
      footnote: null
    }
  },
  {
    ctaUrl: (content) => `${APP_BASE}/?${utm('pricing_nudge', content)}#payment`
  }
);

// ---------------------------------------------------------------------------
// Lifecycle (broadcast stream)
// ---------------------------------------------------------------------------

const geoNotUsed = defineTemplate(
  {
    en: {
      subject: 'Put your street on a real map',
      bodyHtml: `  <p>Did you know your 3DStreet scenes can sit on a photorealistic 3D map of the real world?</p>

  <p>Your account includes <strong>free geo tokens</strong> for Google 3D Map Tiles. Search for any address, drop your street design into the actual neighborhood, and see it in context. It's the fastest way to make a proposal feel real.</p>`,
      bodyText: `Did you know your 3DStreet scenes can sit on a photorealistic 3D map of the real world?

Your account includes free geo tokens for Google 3D Map Tiles. Search for any address, drop your street design into the actual neighborhood, and see it in context. It's the fastest way to make a proposal feel real.`,
      ctaLabel: 'Try 3D maps',
      footnote: null
    },
    es: {
      subject: 'Pon tu calle en un mapa real',
      bodyHtml: `  <p>¿Sabías que tus escenas de 3DStreet pueden situarse sobre un mapa 3D fotorrealista del mundo real?</p>

  <p>Tu cuenta incluye <strong>tokens geo gratuitos</strong> para Google 3D Map Tiles. Busca cualquier dirección, coloca tu diseño de calle en el barrio real y míralo en contexto. Es la forma más rápida de hacer que una propuesta se sienta real.</p>`,
      bodyText: `¿Sabías que tus escenas de 3DStreet pueden situarse sobre un mapa 3D fotorrealista del mundo real?

Tu cuenta incluye tokens geo gratuitos para Google 3D Map Tiles. Busca cualquier dirección, coloca tu diseño de calle en el barrio real y míralo en contexto. Es la forma más rápida de hacer que una propuesta se sienta real.`,
      ctaLabel: 'Probar los mapas 3D',
      footnote: null
    },
    'pt-BR': {
      subject: 'Coloque sua rua em um mapa real',
      bodyHtml: `  <p>Você sabia que suas cenas do 3DStreet podem ficar sobre um mapa 3D fotorrealista do mundo real?</p>

  <p>Sua conta inclui <strong>tokens geo gratuitos</strong> para o Google 3D Map Tiles. Pesquise qualquer endereço, coloque o seu projeto de rua no bairro de verdade e veja tudo em contexto. É o jeito mais rápido de fazer uma proposta parecer real.</p>`,
      bodyText: `Você sabia que suas cenas do 3DStreet podem ficar sobre um mapa 3D fotorrealista do mundo real?

Sua conta inclui tokens geo gratuitos para o Google 3D Map Tiles. Pesquise qualquer endereço, coloque o seu projeto de rua no bairro de verdade e veja tudo em contexto. É o jeito mais rápido de fazer uma proposta parecer real.`,
      ctaLabel: 'Experimentar mapas 3D',
      footnote: null
    },
    fr: {
      subject: 'Placez votre rue sur une vraie carte',
      bodyHtml: `  <p>Saviez-vous que vos scènes 3DStreet peuvent se poser sur une carte 3D photoréaliste du monde réel ?</p>

  <p>Votre compte inclut des <strong>jetons géo gratuits</strong> pour les tuiles Google 3D Map Tiles. Recherchez n'importe quelle adresse, déposez votre projet de rue dans le vrai quartier et visualisez-le en contexte. C'est le moyen le plus rapide de rendre une proposition concrète.</p>`,
      bodyText: `Saviez-vous que vos scènes 3DStreet peuvent se poser sur une carte 3D photoréaliste du monde réel ?

Votre compte inclut des jetons géo gratuits pour les tuiles Google 3D Map Tiles. Recherchez n'importe quelle adresse, déposez votre projet de rue dans le vrai quartier et visualisez-le en contexte. C'est le moyen le plus rapide de rendre une proposition concrète.`,
      ctaLabel: 'Essayer les cartes 3D',
      footnote: null
    }
  },
  { ctaUrl: (content) => `${APP_BASE}/?${utm('geo_not_used', content)}` }
);

// ---------------------------------------------------------------------------
// Token exhaustion (outbound stream — sent by the daily sweep in
// scheduled/scheduledEmails.js, which picks geo vs gen per user)
// ---------------------------------------------------------------------------

const tokenExhaustionCta = (campaign) => (content) =>
  `${APP_BASE}/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=${campaign}&utm_content=${content}#modal/payment`;

const TOKEN_EXHAUSTION_FOOTNOTES = {
  en: {
    footnote:
      'You received this email because you created an account on 3DStreet.<br>\n    This message is only sent once. If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.',
    footnoteText:
      'You received this email because you created an account on 3DStreet. This message is only sent once.\nIf you have questions, reply to this email or visit https://3dstreet.com/docs/'
  },
  es: {
    footnote:
      'Recibes este correo porque creaste una cuenta en 3DStreet.<br>\n    Este mensaje se envía una sola vez. Si tienes preguntas, responde a este correo o visita <a href="https://3dstreet.com/docs/" style="color: #6366f1;">nuestra documentación</a>.',
    footnoteText:
      'Recibes este correo porque creaste una cuenta en 3DStreet. Este mensaje se envía una sola vez.\nSi tienes preguntas, responde a este correo o visita https://3dstreet.com/docs/'
  },
  'pt-BR': {
    footnote:
      'Você recebeu este e-mail porque criou uma conta no 3DStreet.<br>\n    Esta mensagem é enviada uma única vez. Se tiver dúvidas, responda a este e-mail ou visite <a href="https://3dstreet.com/docs/" style="color: #6366f1;">nossa documentação</a>.',
    footnoteText:
      'Você recebeu este e-mail porque criou uma conta no 3DStreet. Esta mensagem é enviada uma única vez.\nSe tiver dúvidas, responda a este e-mail ou visite https://3dstreet.com/docs/'
  },
  fr: {
    footnote:
      "Vous recevez cet e-mail parce que vous avez créé un compte sur 3DStreet.<br>\n    Ce message n'est envoyé qu'une seule fois. Pour toute question, répondez à cet e-mail ou consultez <a href=\"https://3dstreet.com/docs/\" style=\"color: #6366f1;\">notre documentation</a>.",
    footnoteText:
      "Vous recevez cet e-mail parce que vous avez créé un compte sur 3DStreet. Ce message n'est envoyé qu'une seule fois.\nPour toute question, répondez à cet e-mail ou consultez https://3dstreet.com/docs/"
  }
};

const geoTokenExhaustion = defineTemplate(
  {
    en: {
      subject: "You've used all your geo tokens on 3DStreet",
      bodyHtml: `  <p>You've used all of your free <strong>geo tokens</strong> on 3DStreet. Geo tokens let you access Google 3D Tiles to see real-world context around your street designs.</p>

  <p>Want to keep designing with real-world context? <strong>Upgrade to 3DStreet Pro</strong> and get:</p>

  <ul style="padding-left: 20px;">
    <li>Unlimited geo tokens for Google 3D Tiles</li>
    <li>100 AI generation tokens per month</li>
    <li>Priority support</li>
    <li>Early access to new features</li>
  </ul>

  <p>Thanks for using 3DStreet!</p>`,
      bodyText: `You've used all of your free geo tokens on 3DStreet. Geo tokens let you access Google 3D Tiles to see real-world context around your street designs.

Want to keep designing with real-world context? Upgrade to 3DStreet Pro and get:

- Unlimited geo tokens for Google 3D Tiles
- 100 AI generation tokens per month
- Priority support
- Early access to new features

Thanks for using 3DStreet!`,
      ctaLabel: 'Upgrade to Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES.en
    },
    es: {
      subject: 'Has usado todos tus tokens geo de 3DStreet',
      bodyHtml: `  <p>Has usado todos tus <strong>tokens geo</strong> gratuitos de 3DStreet. Los tokens geo te dan acceso a Google 3D Tiles para ver el contexto del mundo real alrededor de tus diseños de calles.</p>

  <p>¿Quieres seguir diseñando con contexto del mundo real? <strong>Actualiza a 3DStreet Pro</strong> y obtén:</p>

  <ul style="padding-left: 20px;">
    <li>Tokens geo ilimitados para Google 3D Tiles</li>
    <li>100 tokens de generación con IA al mes</li>
    <li>Soporte prioritario</li>
    <li>Acceso anticipado a nuevas funciones</li>
  </ul>

  <p>¡Gracias por usar 3DStreet!</p>`,
      bodyText: `Has usado todos tus tokens geo gratuitos de 3DStreet. Los tokens geo te dan acceso a Google 3D Tiles para ver el contexto del mundo real alrededor de tus diseños de calles.

¿Quieres seguir diseñando con contexto del mundo real? Actualiza a 3DStreet Pro y obtén:

- Tokens geo ilimitados para Google 3D Tiles
- 100 tokens de generación con IA al mes
- Soporte prioritario
- Acceso anticipado a nuevas funciones

¡Gracias por usar 3DStreet!`,
      ctaLabel: 'Actualizar a Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES.es
    },
    'pt-BR': {
      subject: 'Você usou todos os seus tokens geo no 3DStreet',
      bodyHtml: `  <p>Você usou todos os seus <strong>tokens geo</strong> gratuitos no 3DStreet. Os tokens geo dão acesso ao Google 3D Tiles para ver o contexto do mundo real ao redor dos seus projetos de rua.</p>

  <p>Quer continuar projetando com contexto do mundo real? <strong>Assine o 3DStreet Pro</strong> e receba:</p>

  <ul style="padding-left: 20px;">
    <li>Tokens geo ilimitados para o Google 3D Tiles</li>
    <li>100 tokens de geração com IA por mês</li>
    <li>Suporte prioritário</li>
    <li>Acesso antecipado a novos recursos</li>
  </ul>

  <p>Obrigado por usar o 3DStreet!</p>`,
      bodyText: `Você usou todos os seus tokens geo gratuitos no 3DStreet. Os tokens geo dão acesso ao Google 3D Tiles para ver o contexto do mundo real ao redor dos seus projetos de rua.

Quer continuar projetando com contexto do mundo real? Assine o 3DStreet Pro e receba:

- Tokens geo ilimitados para o Google 3D Tiles
- 100 tokens de geração com IA por mês
- Suporte prioritário
- Acesso antecipado a novos recursos

Obrigado por usar o 3DStreet!`,
      ctaLabel: 'Assinar o Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES['pt-BR']
    },
    fr: {
      subject: 'Vous avez utilisé tous vos jetons géo sur 3DStreet',
      bodyHtml: `  <p>Vous avez utilisé tous vos <strong>jetons géo</strong> gratuits sur 3DStreet. Les jetons géo donnent accès aux tuiles Google 3D Tiles pour visualiser le contexte réel autour de vos projets de rue.</p>

  <p>Envie de continuer à concevoir avec le contexte du monde réel ? <strong>Passez à 3DStreet Pro</strong> et obtenez :</p>

  <ul style="padding-left: 20px;">
    <li>Des jetons géo illimités pour Google 3D Tiles</li>
    <li>100 jetons de génération IA par mois</li>
    <li>Une assistance prioritaire</li>
    <li>Un accès anticipé aux nouveautés</li>
  </ul>

  <p>Merci d'utiliser 3DStreet !</p>`,
      bodyText: `Vous avez utilisé tous vos jetons géo gratuits sur 3DStreet. Les jetons géo donnent accès aux tuiles Google 3D Tiles pour visualiser le contexte réel autour de vos projets de rue.

Envie de continuer à concevoir avec le contexte du monde réel ? Passez à 3DStreet Pro et obtenez :

- Des jetons géo illimités pour Google 3D Tiles
- 100 jetons de génération IA par mois
- Une assistance prioritaire
- Un accès anticipé aux nouveautés

Merci d'utiliser 3DStreet !`,
      ctaLabel: 'Passer à Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES.fr
    }
  },
  { ctaUrl: tokenExhaustionCta('geo_zero') }
);

const genTokenExhaustion = defineTemplate(
  {
    en: {
      subject: "You've used all your AI tokens on 3DStreet",
      bodyHtml: `  <p>You've used all of your free <strong>AI generation tokens</strong> on 3DStreet. AI tokens let you create stunning photorealistic renders of your street designs using our AI image generator.</p>

  <p>Want to keep creating amazing renders? <strong>Upgrade to 3DStreet Pro</strong> and get:</p>

  <ul style="padding-left: 20px;">
    <li>100 AI generation tokens per month</li>
    <li>Unlimited geo tokens for Google 3D Tiles</li>
    <li>Priority support</li>
    <li>Early access to new features</li>
  </ul>

  <p>Thanks for using 3DStreet!</p>`,
      bodyText: `You've used all of your free AI generation tokens on 3DStreet. AI tokens let you create stunning photorealistic renders of your street designs using our AI image generator.

Want to keep creating amazing renders? Upgrade to 3DStreet Pro and get:

- 100 AI generation tokens per month
- Unlimited geo tokens for Google 3D Tiles
- Priority support
- Early access to new features

Thanks for using 3DStreet!`,
      ctaLabel: 'Upgrade to Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES.en
    },
    es: {
      subject: 'Has usado todos tus tokens de IA de 3DStreet',
      bodyHtml: `  <p>Has usado todos tus <strong>tokens de generación con IA</strong> gratuitos de 3DStreet. Los tokens de IA te permiten crear impresionantes renders fotorrealistas de tus diseños de calles con nuestro generador de imágenes con IA.</p>

  <p>¿Quieres seguir creando renders increíbles? <strong>Actualiza a 3DStreet Pro</strong> y obtén:</p>

  <ul style="padding-left: 20px;">
    <li>100 tokens de generación con IA al mes</li>
    <li>Tokens geo ilimitados para Google 3D Tiles</li>
    <li>Soporte prioritario</li>
    <li>Acceso anticipado a nuevas funciones</li>
  </ul>

  <p>¡Gracias por usar 3DStreet!</p>`,
      bodyText: `Has usado todos tus tokens de generación con IA gratuitos de 3DStreet. Los tokens de IA te permiten crear impresionantes renders fotorrealistas de tus diseños de calles con nuestro generador de imágenes con IA.

¿Quieres seguir creando renders increíbles? Actualiza a 3DStreet Pro y obtén:

- 100 tokens de generación con IA al mes
- Tokens geo ilimitados para Google 3D Tiles
- Soporte prioritario
- Acceso anticipado a nuevas funciones

¡Gracias por usar 3DStreet!`,
      ctaLabel: 'Actualizar a Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES.es
    },
    'pt-BR': {
      subject: 'Você usou todos os seus tokens de IA no 3DStreet',
      bodyHtml: `  <p>Você usou todos os seus <strong>tokens de geração com IA</strong> gratuitos no 3DStreet. Os tokens de IA permitem criar renderizações fotorrealistas impressionantes dos seus projetos de rua com o nosso gerador de imagens com IA.</p>

  <p>Quer continuar criando renderizações incríveis? <strong>Assine o 3DStreet Pro</strong> e receba:</p>

  <ul style="padding-left: 20px;">
    <li>100 tokens de geração com IA por mês</li>
    <li>Tokens geo ilimitados para o Google 3D Tiles</li>
    <li>Suporte prioritário</li>
    <li>Acesso antecipado a novos recursos</li>
  </ul>

  <p>Obrigado por usar o 3DStreet!</p>`,
      bodyText: `Você usou todos os seus tokens de geração com IA gratuitos no 3DStreet. Os tokens de IA permitem criar renderizações fotorrealistas impressionantes dos seus projetos de rua com o nosso gerador de imagens com IA.

Quer continuar criando renderizações incríveis? Assine o 3DStreet Pro e receba:

- 100 tokens de geração com IA por mês
- Tokens geo ilimitados para o Google 3D Tiles
- Suporte prioritário
- Acesso antecipado a novos recursos

Obrigado por usar o 3DStreet!`,
      ctaLabel: 'Assinar o Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES['pt-BR']
    },
    fr: {
      subject: 'Vous avez utilisé tous vos jetons IA sur 3DStreet',
      bodyHtml: `  <p>Vous avez utilisé tous vos <strong>jetons de génération IA</strong> gratuits sur 3DStreet. Les jetons IA vous permettent de créer d'impressionnants rendus photoréalistes de vos projets de rue avec notre générateur d'images IA.</p>

  <p>Envie de continuer à créer de superbes rendus ? <strong>Passez à 3DStreet Pro</strong> et obtenez :</p>

  <ul style="padding-left: 20px;">
    <li>100 jetons de génération IA par mois</li>
    <li>Des jetons géo illimités pour Google 3D Tiles</li>
    <li>Une assistance prioritaire</li>
    <li>Un accès anticipé aux nouveautés</li>
  </ul>

  <p>Merci d'utiliser 3DStreet !</p>`,
      bodyText: `Vous avez utilisé tous vos jetons de génération IA gratuits sur 3DStreet. Les jetons IA vous permettent de créer d'impressionnants rendus photoréalistes de vos projets de rue avec notre générateur d'images IA.

Envie de continuer à créer de superbes rendus ? Passez à 3DStreet Pro et obtenez :

- 100 jetons de génération IA par mois
- Des jetons géo illimités pour Google 3D Tiles
- Une assistance prioritaire
- Un accès anticipé aux nouveautés

Merci d'utiliser 3DStreet !`,
      ctaLabel: 'Passer à Pro',
      ...TOKEN_EXHAUSTION_FOOTNOTES.fr
    }
  },
  { ctaUrl: tokenExhaustionCta('ai_zero') }
);

// ---------------------------------------------------------------------------
// Project Pass (#1922) — sent when a pass code is redeemed (pass-codes.js).
// Transactional: it's the receipt for something the recipient just claimed,
// and it doubles as the "where do I sign in" reminder. `data`:
//   { fromName?, days, tokens, proUntilMs }
// fromName is the optional display name the buyer chose when the code was
// minted (e.g. "Prof. Smith, WSU"); without it the email doesn't say who.
// Every field is optional so the template still renders sensibly (the
// template test suite renders it with unrelated data).
// ---------------------------------------------------------------------------

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const passFacts = (data = {}) => {
  const days = Number.isFinite(data.days) && data.days > 0 ? data.days : 90;
  const tokens = Number.isFinite(data.tokens) && data.tokens >= 0 ? data.tokens : 300;
  const fromName =
    typeof data.fromName === 'string' && data.fromName.trim() ? data.fromName.trim() : '';
  return {
    days,
    tokens,
    months: days % 30 === 0 ? days / 30 : null,
    fromText: fromName,
    fromHtml: fromName ? escapeHtml(fromName) : '',
    untilMs: Number.isFinite(data.proUntilMs) ? data.proUntilMs : null
  };
};

const passDate = (ms, locale) => {
  if (ms === null) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(ms)
    );
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
};

// Per-locale phrasing for the pass duration and end date.
const PASS_PHRASES = {
  en: {
    name: 'Project Pass',
    full: '3DStreet Project Pass',
    duration: (f) => (f.months ? `${f.months} months` : `${f.days} days`),
    until: (f) => (f.untilMs !== null ? `, through ${passDate(f.untilMs, 'en')}` : '')
  },
  es: {
    name: 'Pase de Proyecto',
    full: 'Pase de Proyecto de 3DStreet',
    duration: (f) => (f.months ? `${f.months} meses` : `${f.days} días`),
    until: (f) => (f.untilMs !== null ? `, hasta el ${passDate(f.untilMs, 'es')}` : '')
  },
  'pt-BR': {
    name: 'Passe de Projeto',
    full: 'Passe de Projeto do 3DStreet',
    duration: (f) => (f.months ? `${f.months} meses` : `${f.days} dias`),
    until: (f) => (f.untilMs !== null ? `, até ${passDate(f.untilMs, 'pt-BR')}` : '')
  },
  fr: {
    name: 'Pass Projet',
    full: 'Pass Projet 3DStreet',
    duration: (f) => (f.months ? `${f.months} mois` : `${f.days} jours`),
    until: (f) => (f.untilMs !== null ? `, jusqu'au ${passDate(f.untilMs, 'fr')}` : '')
  }
};

const passActivatedCopy = (locale, words) => {
  const P = PASS_PHRASES[locale];
  const facts = (data) => passFacts(data);
  const list = (f) => words.items(f);
  return {
    subject: (data) => {
      const f = facts(data);
      return f.fromText ? words.subjectFrom(f.fromText, P.name) : words.subject(P.name);
    },
    bodyHtml: (data) => {
      const f = facts(data);
      const lead = f.fromHtml
        ? words.leadFrom(`<strong>${f.fromHtml}</strong>`, `<strong>${P.full}</strong>`)
        : words.lead(`<strong>${P.full}</strong>`);
      return `  <p>${lead}</p>

  <p>${words.summary(P.duration(f), P.until(f), f.tokens)}</p>

  <ul style="padding-left: 20px;">
${list(f)
  .map((item) => `    <li>${item}</li>`)
  .join('\n')}
  </ul>

  <p>${words.signIn('<a href="https://3dstreet.app" style="color: #6366f1;">3dstreet.app</a>')}</p>

  <p>${words.after}</p>`;
    },
    bodyText: (data) => {
      const f = facts(data);
      const lead = f.fromText
        ? words.leadFrom(f.fromText, P.full)
        : words.lead(P.full);
      return `${lead}

${words.summary(P.duration(f), P.until(f), f.tokens)}

${list(f)
  .map((item) => `- ${item.replace(/&amp;/g, '&')}`)
  .join('\n')}

${words.signIn('3dstreet.app')}

${words.after}`;
    },
    ctaLabel: words.cta,
    footnote: words.footnote
  };
};

const passActivated = defineTemplate(
  {
    en: passActivatedCopy('en', {
      subjectFrom: (from, name) => `${from} sent you a 3DStreet ${name}`,
      subject: (name) => `Your 3DStreet ${name} is active`,
      leadFrom: (from, pass) => `${from} sent you a ${pass}, and it's now active on your account.`,
      lead: (pass) => `Your ${pass} is now active on your account.`,
      summary: (duration, until, tokens) =>
        `That's ${duration} of 3DStreet Pro${until}, plus ${tokens} AI generation tokens. Here's what's included:`,
      items: (f) => [
        'Watermark-free snapshots and HD renders',
        'Unlimited geospatial maps &amp; location changes',
        `${f.tokens} AI generation tokens for images, video and 3D`,
        '3D model glTF export',
        'More storage for uploading your own 3D models, scans and images'
      ],
      signIn: (site) => `To get back in anytime, sign in at ${site} with this email address.`,
      after:
        'When the pass ends, your account returns to the free plan. Your scenes and files stay, and so do any unused tokens. Nothing renews and you will not be charged.',
      cta: 'Open 3DStreet',
      footnote:
        'You received this email because you redeemed a Project Pass code on 3DStreet. Questions? Just reply to this email.'
    }),
    es: passActivatedCopy('es', {
      subjectFrom: (from, name) => `${from} te envió un ${name} de 3DStreet`,
      subject: (name) => `Tu ${name} de 3DStreet está activo`,
      leadFrom: (from, pass) => `${from} te envió un ${pass} y ya está activo en tu cuenta.`,
      lead: (pass) => `Tu ${pass} ya está activo en tu cuenta.`,
      summary: (duration, until, tokens) =>
        `Son ${duration} de 3DStreet Pro${until}, más ${tokens} tokens de generación con IA. Esto es lo que incluye:`,
      items: (f) => [
        'Capturas y renders en HD sin marca de agua',
        'Mapas geoespaciales y cambios de ubicación ilimitados',
        `${f.tokens} tokens de generación con IA para imágenes, video y 3D`,
        'Exportación de modelos 3D en glTF',
        'Más almacenamiento para subir tus propios modelos 3D, escaneos e imágenes'
      ],
      signIn: (site) =>
        `Para volver a entrar cuando quieras, inicia sesión en ${site} con esta dirección de correo.`,
      after:
        'Cuando termine el pase, tu cuenta volverá al plan gratuito. Tus escenas y archivos se conservan, igual que los tokens que no hayas usado. No hay renovación ni se te cobrará nada.',
      cta: 'Abrir 3DStreet',
      footnote:
        'Recibes este correo porque canjeaste un código de Pase de Proyecto en 3DStreet. ¿Tienes preguntas? Simplemente responde a este correo.'
    }),
    'pt-BR': passActivatedCopy('pt-BR', {
      subjectFrom: (from, name) => `${from} enviou para você um ${name} do 3DStreet`,
      subject: (name) => `Seu ${name} do 3DStreet está ativo`,
      leadFrom: (from, pass) => `${from} enviou para você um ${pass}, e ele já está ativo na sua conta.`,
      lead: (pass) => `Seu ${pass} já está ativo na sua conta.`,
      summary: (duration, until, tokens) =>
        `São ${duration} de 3DStreet Pro${until}, mais ${tokens} tokens de geração com IA. Veja o que está incluído:`,
      items: (f) => [
        "Capturas e renderizações em HD sem marca d'água",
        'Mapas geoespaciais e trocas de localização ilimitados',
        `${f.tokens} tokens de geração com IA para imagens, vídeo e 3D`,
        'Exportação de modelos 3D em glTF',
        'Mais armazenamento para enviar seus próprios modelos 3D, escaneamentos e imagens'
      ],
      signIn: (site) =>
        `Para voltar quando quiser, entre em ${site} com este endereço de e-mail.`,
      after:
        'Quando o passe terminar, sua conta volta ao plano gratuito. Suas cenas e arquivos continuam salvos, assim como os tokens que você não usou. Nada é renovado e você não será cobrado.',
      cta: 'Abrir o 3DStreet',
      footnote:
        'Você recebeu este e-mail porque resgatou um código de Passe de Projeto no 3DStreet. Dúvidas? É só responder a este e-mail.'
    }),
    fr: passActivatedCopy('fr', {
      subjectFrom: (from, name) => `${from} vous a envoyé un ${name} 3DStreet`,
      subject: (name) => `Votre ${name} 3DStreet est actif`,
      leadFrom: (from, pass) => `${from} vous a envoyé un ${pass}, et il est désormais actif sur votre compte.`,
      lead: (pass) => `Votre ${pass} est désormais actif sur votre compte.`,
      summary: (duration, until, tokens) =>
        `Cela représente ${duration} de 3DStreet Pro${until}, plus ${tokens} jetons de génération IA. Voici ce qui est inclus :`,
      items: (f) => [
        'Captures et rendus HD sans filigrane',
        'Cartes géospatiales et changements de lieu illimités',
        `${f.tokens} jetons de génération IA pour les images, la vidéo et la 3D`,
        'Export de modèles 3D au format glTF',
        "Plus d'espace de stockage pour importer vos propres modèles 3D, scans et images"
      ],
      signIn: (site) =>
        `Pour revenir à tout moment, connectez-vous sur ${site} avec cette adresse e-mail.`,
      after:
        "À la fin du pass, votre compte repasse au forfait gratuit. Vos scènes et fichiers sont conservés, tout comme les jetons non utilisés. Rien n'est renouvelé et rien ne vous sera facturé.",
      cta: 'Ouvrir 3DStreet',
      footnote:
        'Vous recevez cet e-mail parce que vous avez utilisé un code Pass Projet sur 3DStreet. Des questions ? Répondez simplement à cet e-mail.'
    })
  },
  { ctaUrl: (content) => `${APP_BASE}/?${utm('pass_activated', content)}` }
);

// Sent to a pass code's contact (notifyEmail) each time a pass is redeemed.
// There is no code dashboard, so this email is the buyer's status report:
// which code, uses so far, when this pass ends and the code's redeem-by
// date. It names who redeemed so the buyer can spot a code that leaked, and
// has no CTA: the next step, if any, is replying to us.
const codeFacts = (data = {}) => {
  const f = passFacts(data);
  const uses = Number.isInteger(data.uses) && data.uses > 0 ? data.uses : null;
  const maxUses = Number.isInteger(data.maxUses) && data.maxUses > 0 ? data.maxUses : null;
  const code = typeof data.code === 'string' ? data.code : '';
  return {
    ...f,
    code,
    uses,
    maxUses,
    left: uses !== null && maxUses !== null ? Math.max(maxUses - uses, 0) : null,
    redeemByMs: Number.isFinite(data.redeemByMs) ? data.redeemByMs : null,
    link: code ? `${APP_BASE}/#redeem?code=${code}` : '',
    by: [data.redeemerName, data.redeemerEmail && `<${data.redeemerEmail}>`]
      .filter((v) => typeof v === 'string' && v.trim())
      .join(' ')
  };
};

const passCodeRedeemedCopy = (locale, words) => {
  const P = PASS_PHRASES[locale];
  const items = (f, strong) =>
    [
      f.code && words.code(strong(f.code)),
      f.by && words.by(strong(f.by)),
      f.left !== null && words.used(f.uses, f.maxUses, f.left),
      words.thisPass(P.duration(f), P.until(f), f.tokens),
      f.left && f.redeemByMs !== null && words.redeemBy(passDate(f.redeemByMs, locale))
    ].filter(Boolean);
  const share = (f, link) => (f.left === 0 ? words.allUsed : f.link ? words.share(link) : '');
  return {
    subject: (data) => {
      const f = codeFacts(data);
      return f.left !== null ? words.subjectCount(f.uses, f.maxUses) : words.subject;
    },
    bodyHtml: (data) => {
      const f = codeFacts(data);
      const link = `<a href="${f.link}" style="color: #6366f1;">${f.link}</a>`;
      const next = share(f, link);
      return `  <p>${words.lead(`<strong>${P.full}</strong>`)}</p>

  <ul style="padding-left: 20px;">
${items(f, (s) => `<strong>${escapeHtml(s)}</strong>`)
  .map((item) => `    <li>${item}</li>`)
  .join('\n')}
  </ul>
${next ? `\n  <p>${next}</p>\n` : ''}
  <p>${words.unfamiliar}</p>

  <p>${words.support}</p>`;
    },
    bodyText: (data) => {
      const f = codeFacts(data);
      const next = share(f, f.link);
      return `${words.lead(P.full)}

${items(f, (s) => s)
  .map((item) => `- ${item}`)
  .join('\n')}
${next ? `\n${next}\n` : ''}
${words.unfamiliar}

${words.support}`;
    },
    footnote: words.footnote
  };
};

const passCodeRedeemed = defineTemplate({
  en: passCodeRedeemedCopy('en', {
    subjectCount: (uses, max) => `Your Project Pass code was redeemed (${uses} of ${max} used)`,
    subject: 'Your Project Pass code was redeemed',
    lead: (pass) => `Someone just redeemed a ${pass} from your code. Here's where it stands:`,
    code: (code) => `Code: ${code}`,
    by: (who) => `Redeemed by: ${who}`,
    used: (uses, max, left) => `Passes used: ${uses} of ${max} (${left} left)`,
    thisPass: (duration, until, tokens) =>
      `This pass: ${duration} of 3DStreet Pro${until}, plus ${tokens} AI generation tokens`,
    redeemBy: (date) => `Remaining passes can be redeemed until ${date}`,
    share: (link) => `To share the remaining passes, send people this link: ${link}`,
    allUsed: 'All passes on this code have now been redeemed.',
    unfamiliar:
      "If you don't recognize this person, reply to this email and let us know.",
    support:
      "There's no dashboard for pass codes yet. To check on this code, add passes, change who gets these updates, or turn the code off, just reply to this email and our team will help.",
    footnote:
      "You received this email because you're the contact for a 3DStreet Project Pass code."
  }),
  es: passCodeRedeemedCopy('es', {
    subjectCount: (uses, max) =>
      `Se canjeó tu código de Pase de Proyecto (${uses} de ${max} usados)`,
    subject: 'Se canjeó tu código de Pase de Proyecto',
    lead: (pass) => `Alguien acaba de canjear un ${pass} con tu código. Este es su estado:`,
    code: (code) => `Código: ${code}`,
    by: (who) => `Canjeado por: ${who}`,
    used: (uses, max, left) => `Pases usados: ${uses} de ${max} (quedan ${left})`,
    thisPass: (duration, until, tokens) =>
      `Este pase: ${duration} de 3DStreet Pro${until}, más ${tokens} tokens de generación con IA`,
    redeemBy: (date) => `Los pases restantes se pueden canjear hasta el ${date}`,
    share: (link) => `Para compartir los pases restantes, envía este enlace: ${link}`,
    allUsed: 'Ya se canjearon todos los pases de este código.',
    unfamiliar:
      'Si no reconoces a esta persona, responde a este correo y avísanos.',
    support:
      'Todavía no hay un panel para los códigos de pase. Para consultar este código, añadir pases, cambiar quién recibe estas actualizaciones o desactivar el código, simplemente responde a este correo y nuestro equipo te ayudará.',
    footnote:
      'Recibes este correo porque eres el contacto de un código de Pase de Proyecto de 3DStreet.'
  }),
  'pt-BR': passCodeRedeemedCopy('pt-BR', {
    subjectCount: (uses, max) =>
      `Seu código de Passe de Projeto foi resgatado (${uses} de ${max} usados)`,
    subject: 'Seu código de Passe de Projeto foi resgatado',
    lead: (pass) => `Alguém acabou de resgatar um ${pass} com o seu código. Veja a situação:`,
    code: (code) => `Código: ${code}`,
    by: (who) => `Resgatado por: ${who}`,
    used: (uses, max, left) => `Passes usados: ${uses} de ${max} (restam ${left})`,
    thisPass: (duration, until, tokens) =>
      `Este passe: ${duration} de 3DStreet Pro${until}, mais ${tokens} tokens de geração com IA`,
    redeemBy: (date) => `Os passes restantes podem ser resgatados até ${date}`,
    share: (link) => `Para compartilhar os passes restantes, envie este link: ${link}`,
    allUsed: 'Todos os passes deste código já foram resgatados.',
    unfamiliar:
      'Se você não reconhece esta pessoa, responda a este e-mail e nos avise.',
    support:
      'Ainda não há um painel para códigos de passe. Para consultar este código, adicionar passes, mudar quem recebe estas atualizações ou desativar o código, é só responder a este e-mail e nossa equipe vai ajudar.',
    footnote:
      'Você recebeu este e-mail porque é o contato de um código de Passe de Projeto do 3DStreet.'
  }),
  fr: passCodeRedeemedCopy('fr', {
    subjectCount: (uses, max) =>
      `Votre code Pass Projet a été utilisé (${uses} sur ${max})`,
    subject: 'Votre code Pass Projet a été utilisé',
    lead: (pass) => `Quelqu'un vient d'utiliser un ${pass} avec votre code. Voici le point :`,
    code: (code) => `Code : ${code}`,
    by: (who) => `Utilisé par : ${who}`,
    used: (uses, max, left) => `Pass utilisés : ${uses} sur ${max} (il en reste ${left})`,
    thisPass: (duration, until, tokens) =>
      `Ce pass : ${duration} de 3DStreet Pro${until}, plus ${tokens} jetons de génération IA`,
    redeemBy: (date) => `Les pass restants peuvent être utilisés jusqu'au ${date}`,
    share: (link) => `Pour partager les pass restants, envoyez ce lien : ${link}`,
    allUsed: 'Tous les pass de ce code ont maintenant été utilisés.',
    unfamiliar:
      "Si vous ne reconnaissez pas cette personne, répondez à cet e-mail pour nous prévenir.",
    support:
      "Il n'existe pas encore de tableau de bord pour les codes. Pour faire le point sur ce code, ajouter des pass, changer qui reçoit ces mises à jour ou désactiver le code, répondez simplement à cet e-mail et notre équipe vous aidera.",
    footnote:
      'Vous recevez cet e-mail parce que vous êtes le contact d’un code Pass Projet 3DStreet.'
  })
});

module.exports = {
  welcome,
  postUpgradeWelcome,
  failedPayment,
  checkoutAbandoned1h,
  checkoutAbandoned72h,
  pricingPageNudge,
  geoNotUsed,
  geoTokenExhaustion,
  genTokenExhaustion,
  passActivated,
  passCodeRedeemed,
  // Exported for unit tests only (per-key fallback + lang normalization); not
  // a lifecycle template, so callers that enumerate templates must skip it.
  defineTemplate
};
