/**
 * Localized UI strings for the AI Generator app (#1857).
 *
 * The generator is a vanilla-JS app (image / video / splat / 3D-model tabs)
 * with a few React islands, and — like Bollard Buddy — it does NOT mount a
 * react-intl IntlProvider. So, exactly like the shared strings in
 * `@shared/i18n/sharedMessages` and the number/price helpers in
 * `@shared/utils/format`, generator strings are resolved framework-free from a
 * curated table keyed by locale. The active locale is the same `locale`
 * localStorage key the editor/profile-menu switcher persists, falling back to
 * the browser language (see `getActiveLocale`).
 *
 * These strings are NOT part of the formatjs extraction pipeline (that scans
 * for FormattedMessage/defineMessages and feeds the editor-only catalogs), so
 * translations here are hand-maintained. Keep terminology in sync with the
 * editor catalogs (src/editor/i18n/locales/) and @shared/i18n/sharedMessages:
 * geo tokens fr "jetons", assets es/pt "recursos" / fr "actifs", "Splat" and
 * model/product names left untranslated.
 *
 * Because the vanilla DOM is built once at page load, `t()` resolves each id to
 * whatever locale is active at that moment; a later language switch (from the
 * shared profile menu) reloads the page so the whole app re-renders — see the
 * locale-change wiring in index.js.
 *
 * Usage:
 *   import { t } from './i18n/messages.js';
 *   el.textContent = t('image.generateImage');
 *   FluxUI.showNotification(t('image.imageGeneratedRemaining', { remaining, model }));
 */

import { getActiveLocale } from '@shared/utils/format';
import { DEFAULT_LOCALE } from '@shared/i18n/locales';

const MESSAGES = {
  // ── Static chrome (public/generator/index.html) ─────────────────────────
  'nav.loadingApp': {
    en: 'Loading...',
    es: 'Cargando...',
    'pt-BR': 'Carregando...',
    fr: 'Chargement...'
  },
  'nav.appTitle': {
    en: 'AI Generator',
    es: 'Generador de IA',
    'pt-BR': 'Gerador de IA',
    fr: 'Générateur IA'
  },
  'nav.tabImage': {
    en: 'Image',
    es: 'Imagen',
    'pt-BR': 'Imagem',
    fr: 'Image'
  },
  'nav.tabVideo': {
    en: 'Video',
    es: 'Video',
    'pt-BR': 'Vídeo',
    fr: 'Vidéo'
  },
  // "Splat" is a technical term (Gaussian splats), left untranslated to match
  // the editor + shared catalogs.
  'nav.tabSplat': {
    en: 'Splat',
    es: 'Splat',
    'pt-BR': 'Splat',
    fr: 'Splat'
  },
  'nav.tab3dModel': {
    en: '3D Model',
    es: 'Modelo 3D',
    'pt-BR': 'Modelo 3D',
    fr: 'Modèle 3D'
  },

  // ── Token tooltip (main.js) ─────────────────────────────────────────────
  'common.outOfTokensTooltip': {
    en: 'You are out of AI Generation Tokens. Click to purchase more.',
    es: 'Te quedaste sin tokens de generación IA. Haz clic para comprar más.',
    'pt-BR':
      'Você ficou sem tokens de geração de IA. Clique para comprar mais.',
    fr: "Vous n'avez plus de jetons de génération IA. Cliquez pour en acheter."
  },

  // ── Image generator (generator-tab-base.js + image.js) ──────────────────
  'image.settingsTitle': {
    en: 'Image Settings',
    es: 'Ajustes de imagen',
    'pt-BR': 'Configurações de imagem',
    fr: "Paramètres d'image"
  },
  'image.settingsDescription': {
    en: 'Generate an image from a text prompt, optionally guided by a reference image.',
    es: 'Genera una imagen a partir de un texto, opcionalmente guiada por una imagen de referencia.',
    'pt-BR':
      'Gere uma imagem a partir de um texto, opcionalmente guiada por uma imagem de referência.',
    fr: "Générez une image à partir d'une invite textuelle, éventuellement guidée par une image de référence."
  },
  'image.referenceImage': {
    en: 'Reference Image',
    es: 'Imagen de referencia',
    'pt-BR': 'Imagem de referência',
    fr: 'Image de référence'
  },
  'image.sourceImage': {
    en: 'Source Image',
    es: 'Imagen de origen',
    'pt-BR': 'Imagem de origem',
    fr: 'Image source'
  },
  'image.requiredForModel': {
    en: 'Required for this model',
    es: 'Requerida para este modelo',
    'pt-BR': 'Obrigatória para este modelo',
    fr: 'Requise pour ce modèle'
  },
  'image.recommendedForResults': {
    en: 'Recommended for better results',
    es: 'Recomendada para mejores resultados',
    'pt-BR': 'Recomendada para melhores resultados',
    fr: 'Recommandée pour de meilleurs résultats'
  },
  'image.clickToUpload': {
    en: 'Click to upload an image',
    es: 'Haz clic para subir una imagen',
    'pt-BR': 'Clique para enviar uma imagem',
    fr: 'Cliquez pour téléverser une image'
  },
  'image.noFileSelected': {
    en: 'No file selected',
    es: 'Ningún archivo seleccionado',
    'pt-BR': 'Nenhum arquivo selecionado',
    fr: 'Aucun fichier sélectionné'
  },
  'image.clearImage': {
    en: 'Clear image',
    es: 'Quitar imagen',
    'pt-BR': 'Remover imagem',
    fr: "Effacer l'image"
  },
  'image.imageStrength': {
    en: 'Image Strength:',
    es: 'Intensidad de imagen:',
    'pt-BR': 'Intensidade da imagem:',
    fr: "Intensité de l'image :"
  },
  // The required marker (*) is appended in markup; keep the word only.
  'image.promptLabel': {
    en: 'Prompt',
    es: 'Instrucción',
    'pt-BR': 'Instrução',
    fr: 'Invite'
  },
  'image.instructions': {
    en: 'Instructions',
    es: 'Instrucciones',
    'pt-BR': 'Instruções',
    fr: 'Instructions'
  },
  'image.style': {
    en: 'Style',
    es: 'Estilo',
    'pt-BR': 'Estilo',
    fr: 'Style'
  },
  'image.placeholderCreate': {
    en: 'Describe what to generate',
    es: 'Describe qué generar',
    'pt-BR': 'Descreva o que gerar',
    fr: 'Décrivez ce qu’il faut générer'
  },
  'image.placeholderModify': {
    en: 'Describe what to generate or how to change the source image',
    es: 'Describe qué generar o cómo cambiar la imagen de origen',
    'pt-BR': 'Descreva o que gerar ou como alterar a imagem de origem',
    fr: "Décrivez ce qu’il faut générer ou comment modifier l'image source"
  },
  'image.stylePlaceholder': {
    en: 'No style change, use instructions only',
    es: 'Sin cambio de estilo, usa solo las instrucciones',
    'pt-BR': 'Sem mudança de estilo, use apenas as instruções',
    fr: 'Aucun changement de style, utilisez uniquement les instructions'
  },
  'image.model': {
    en: 'Model',
    es: 'Modelo',
    'pt-BR': 'Modelo',
    fr: 'Modèle'
  },
  'image.dimensions': {
    en: 'Dimensions',
    es: 'Dimensiones',
    'pt-BR': 'Dimensões',
    fr: 'Dimensions'
  },
  'image.orientationSquare': {
    en: 'Square',
    es: 'Cuadrada',
    'pt-BR': 'Quadrada',
    fr: 'Carré'
  },
  'image.orientationLandscape': {
    en: 'Landscape',
    es: 'Horizontal',
    'pt-BR': 'Paisagem',
    fr: 'Paysage'
  },
  'image.orientationPortrait': {
    en: 'Portrait',
    es: 'Vertical',
    'pt-BR': 'Retrato',
    fr: 'Portrait'
  },
  'image.aspectRatio': {
    en: 'Aspect Ratio',
    es: 'Relación de aspecto',
    'pt-BR': 'Proporção',
    fr: 'Format'
  },
  'image.aspectSquareOption': {
    en: '1:1 (Square)',
    es: '1:1 (Cuadrada)',
    'pt-BR': '1:1 (Quadrada)',
    fr: '1:1 (Carré)'
  },
  'image.aspectUltrawideOption': {
    en: '21:9 (Ultra-wide)',
    es: '21:9 (Ultrapanorámica)',
    'pt-BR': '21:9 (Ultrapanorâmica)',
    fr: '21:9 (Ultra-large)'
  },
  'image.generateImage': {
    en: 'Generate Image',
    es: 'Generar imagen',
    'pt-BR': 'Gerar imagem',
    fr: "Générer l'image"
  },
  'image.preview': {
    en: 'Preview',
    es: 'Vista previa',
    'pt-BR': 'Pré-visualização',
    fr: 'Aperçu'
  },
  'image.previewPlaceholder': {
    en: 'Your generated image will appear here',
    es: 'Tu imagen generada aparecerá aquí',
    'pt-BR': 'Sua imagem gerada aparecerá aqui',
    fr: 'Votre image générée apparaîtra ici'
  },
  'image.generatingImage': {
    en: 'Generating your image...',
    es: 'Generando tu imagen...',
    'pt-BR': 'Gerando sua imagem...',
    fr: 'Génération de votre image...'
  },
  'image.overtime': {
    en: 'Generation taking longer than expected.',
    es: 'La generación está tardando más de lo esperado.',
    'pt-BR': 'A geração está demorando mais que o esperado.',
    fr: 'La génération prend plus de temps que prévu.'
  },
  'image.emailWhenReady': {
    en: 'Email me when my image is ready (you can close this tab)',
    es: 'Avísame por correo cuando mi imagen esté lista (puedes cerrar esta pestaña)',
    'pt-BR':
      'Avise-me por e-mail quando minha imagem estiver pronta (você pode fechar esta aba)',
    fr: 'Prévenez-moi par e-mail quand mon image est prête (vous pouvez fermer cet onglet)'
  },
  'image.copyParameters': {
    en: 'Copy Parameters',
    es: 'Copiar parámetros',
    'pt-BR': 'Copiar parâmetros',
    fr: 'Copier les paramètres'
  },
  'image.openImage': {
    en: 'Open Image',
    es: 'Abrir imagen',
    'pt-BR': 'Abrir imagem',
    fr: "Ouvrir l'image"
  },
  'image.downloadImage': {
    en: 'Download Image',
    es: 'Descargar imagen',
    'pt-BR': 'Baixar imagem',
    fr: "Télécharger l'image"
  },
  'image.copyImageUrl': {
    en: 'Copy Image URL',
    es: 'Copiar URL de la imagen',
    'pt-BR': 'Copiar URL da imagem',
    fr: "Copier l'URL de l'image"
  },
  'image.addInstructionsOrStyle': {
    en: 'Add instructions or pick a style to generate an image.',
    es: 'Añade instrucciones o elige un estilo para generar una imagen.',
    'pt-BR': 'Adicione instruções ou escolha um estilo para gerar uma imagem.',
    fr: 'Ajoutez des instructions ou choisissez un style pour générer une image.'
  },
  'image.modelRequiresSource': {
    en: 'This model requires a source image. Please upload one to continue.',
    es: 'Este modelo requiere una imagen de origen. Sube una para continuar.',
    'pt-BR':
      'Este modelo requer uma imagem de origem. Envie uma para continuar.',
    fr: 'Ce modèle nécessite une image source. Téléversez-en une pour continuer.'
  },
  'image.invalidModel': {
    en: 'Invalid model selected',
    es: 'Modelo seleccionado no válido',
    'pt-BR': 'Modelo selecionado inválido',
    fr: 'Modèle sélectionné non valide'
  },
  'image.nudgeTitle': {
    en: 'Add a reference image for better results',
    es: 'Añade una imagen de referencia para mejores resultados',
    'pt-BR': 'Adicione uma imagem de referência para melhores resultados',
    fr: 'Ajoutez une image de référence pour de meilleurs résultats'
  },
  'image.nudgeBody': {
    en: 'A photo or reference image gives the AI real-world structure to match, producing far more accurate, usable results. Text-only generation works, but results are rougher and best for quick concepts.',
    es: 'Una foto o imagen de referencia le da a la IA una estructura del mundo real que replicar, produciendo resultados mucho más precisos y aprovechables. La generación solo con texto funciona, pero los resultados son más toscos y sirven mejor para conceptos rápidos.',
    'pt-BR':
      'Uma foto ou imagem de referência dá à IA uma estrutura do mundo real para reproduzir, gerando resultados muito mais precisos e utilizáveis. A geração apenas com texto funciona, mas os resultados são mais brutos e servem melhor para conceitos rápidos.',
    fr: "Une photo ou une image de référence donne à l'IA une structure réelle à reproduire, produisant des résultats bien plus précis et exploitables. La génération à partir du texte seul fonctionne, mais les résultats sont plus grossiers et conviennent surtout aux concepts rapides."
  },
  'image.generateAnyway': {
    en: 'Generate anyway',
    es: 'Generar de todos modos',
    'pt-BR': 'Gerar mesmo assim',
    fr: 'Générer quand même'
  },
  'image.goBack': {
    en: 'Go back',
    es: 'Volver',
    'pt-BR': 'Voltar',
    fr: 'Retour'
  },
  'image.addImageHere': {
    en: 'Add image here',
    es: 'Añade la imagen aquí',
    'pt-BR': 'Adicione a imagem aqui',
    fr: "Ajoutez l'image ici"
  },
  'image.sourceImageRequired': {
    en: 'Source image is required for this model',
    es: 'Se requiere una imagen de origen para este modelo',
    'pt-BR': 'É necessária uma imagem de origem para este modelo',
    fr: 'Une image source est requise pour ce modèle'
  },
  'image.imageGeneratedRemaining': {
    en: 'Image generated and saved to your gallery! {remaining} gen tokens remaining. ({model})',
    es: '¡Imagen generada y guardada en tu galería! Te quedan {remaining} tokens de generación. ({model})',
    'pt-BR':
      'Imagem gerada e salva na sua galeria! Restam {remaining} tokens de geração. ({model})',
    fr: 'Image générée et enregistrée dans votre galerie ! Il reste {remaining} jetons de génération. ({model})'
  },
  'image.imageGenerated': {
    en: 'Image generated and saved to your gallery! ({model})',
    es: '¡Imagen generada y guardada en tu galería! ({model})',
    'pt-BR': 'Imagem gerada e salva na sua galeria! ({model})',
    fr: 'Image générée et enregistrée dans votre galerie ! ({model})'
  },
  'image.takingLongerEmail': {
    en: "Image generation is taking longer than expected. We'll email you when it's ready — it will also appear in your gallery.",
    es: 'La generación de la imagen está tardando más de lo esperado. Te enviaremos un correo cuando esté lista, y también aparecerá en tu galería.',
    'pt-BR':
      'A geração da imagem está demorando mais que o esperado. Enviaremos um e-mail quando estiver pronta, e ela também aparecerá na sua galeria.',
    fr: "La génération de l'image prend plus de temps que prévu. Nous vous enverrons un e-mail dès qu'elle sera prête — elle apparaîtra aussi dans votre galerie."
  },
  'image.takingLongerGallery': {
    en: 'Image generation is taking longer than expected. Check your gallery shortly — it will appear there when finished.',
    es: 'La generación de la imagen está tardando más de lo esperado. Revisa tu galería en breve: aparecerá allí cuando termine.',
    'pt-BR':
      'A geração da imagem está demorando mais que o esperado. Confira sua galeria em breve: ela aparecerá lá quando terminar.',
    fr: "La génération de l'image prend plus de temps que prévu. Consultez votre galerie bientôt — elle y apparaîtra une fois terminée."
  },
  'image.generationFailedReason': {
    en: 'Image generation failed: {reason}',
    es: 'Error al generar la imagen: {reason}',
    'pt-BR': 'Falha na geração da imagem: {reason}',
    fr: "Échec de la génération de l'image : {reason}"
  },
  'image.generationFailedRefunded': {
    en: 'Image generation failed. Your tokens were refunded.',
    es: 'Error al generar la imagen. Se reembolsaron tus tokens.',
    'pt-BR': 'Falha na geração da imagem. Seus tokens foram reembolsados.',
    fr: "Échec de la génération de l'image. Vos jetons ont été remboursés."
  },
  'image.failedToGenerate': {
    en: 'Failed to generate image',
    es: 'Error al generar la imagen',
    'pt-BR': 'Falha ao gerar a imagem',
    fr: "Échec de la génération de l'image"
  },
  'image.signInToGenerate': {
    en: 'Please sign in to use image generation',
    es: 'Inicia sesión para usar la generación de imágenes',
    'pt-BR': 'Faça login para usar a geração de imagens',
    fr: "Connectez-vous pour utiliser la génération d'images"
  },
  'image.noTokensUpgrade': {
    en: 'No tokens available. Please purchase more tokens or upgrade to Pro.',
    es: 'No hay tokens disponibles. Compra más tokens o mejora a Pro.',
    'pt-BR':
      'Nenhum token disponível. Compre mais tokens ou faça upgrade para o Pro.',
    fr: 'Aucun jeton disponible. Achetez plus de jetons ou passez à Pro.'
  },
  'image.unableToDisplay': {
    en: 'Unable to display image directly:',
    es: 'No se puede mostrar la imagen directamente:',
    'pt-BR': 'Não é possível exibir a imagem diretamente:',
    fr: "Impossible d'afficher l'image directement :"
  },
  'image.openInNewTab': {
    en: 'Open Image in New Tab',
    es: 'Abrir imagen en una pestaña nueva',
    'pt-BR': 'Abrir imagem em nova aba',
    fr: "Ouvrir l'image dans un nouvel onglet"
  },
  'image.generating': {
    en: 'Generating...',
    es: 'Generando...',
    'pt-BR': 'Gerando...',
    fr: 'Génération...'
  },
  'image.noImageToOpen': {
    en: 'No image to open',
    es: 'No hay imagen para abrir',
    'pt-BR': 'Nenhuma imagem para abrir',
    fr: 'Aucune image à ouvrir'
  },
  'image.imageOpened': {
    en: 'Image opened in new tab!',
    es: '¡Imagen abierta en una pestaña nueva!',
    'pt-BR': 'Imagem aberta em nova aba!',
    fr: 'Image ouverte dans un nouvel onglet !'
  },
  'image.noImageToDownload': {
    en: 'No image to download',
    es: 'No hay imagen para descargar',
    'pt-BR': 'Nenhuma imagem para baixar',
    fr: 'Aucune image à télécharger'
  },
  'image.imageDownloadStarted': {
    en: 'Image download started!',
    es: '¡Descarga de imagen iniciada!',
    'pt-BR': 'Download da imagem iniciado!',
    fr: "Téléchargement de l'image démarré !"
  },
  'image.failedToDownload': {
    en: 'Failed to download image: {error}',
    es: 'Error al descargar la imagen: {error}',
    'pt-BR': 'Falha ao baixar a imagem: {error}',
    fr: "Échec du téléchargement de l'image : {error}"
  },
  'image.noImageUrlToCopy': {
    en: 'No image URL to copy',
    es: 'No hay URL de imagen para copiar',
    'pt-BR': 'Nenhuma URL de imagem para copiar',
    fr: "Aucune URL d'image à copier"
  },
  'image.imageUrlCopied': {
    en: 'Image URL copied to clipboard!',
    es: '¡URL de la imagen copiada al portapapeles!',
    'pt-BR': 'URL da imagem copiada para a área de transferência!',
    fr: "URL de l'image copiée dans le presse-papiers !"
  },
  'image.failedToCopyUrl': {
    en: 'Failed to copy URL: {error}',
    es: 'Error al copiar la URL: {error}',
    'pt-BR': 'Falha ao copiar a URL: {error}',
    fr: "Échec de la copie de l'URL : {error}"
  },
  'image.noParamsToCopy': {
    en: 'No parameters to copy',
    es: 'No hay parámetros para copiar',
    'pt-BR': 'Nenhum parâmetro para copiar',
    fr: 'Aucun paramètre à copier'
  },
  'image.paramsCopied': {
    en: 'Parameters copied to clipboard!',
    es: '¡Parámetros copiados al portapapeles!',
    'pt-BR': 'Parâmetros copiados para a área de transferência!',
    fr: 'Paramètres copiés dans le presse-papiers !'
  },
  'image.failedToCopyParams': {
    en: 'Failed to copy parameters: {error}',
    es: 'Error al copiar los parámetros: {error}',
    'pt-BR': 'Falha ao copiar os parâmetros: {error}',
    fr: 'Échec de la copie des paramètres : {error}'
  },

  // ── Video tab (video.js) ────────────────────────────────────────────────
  'video.galleryItem': {
    en: 'Gallery Item {id}',
    es: 'Elemento de galería {id}',
    'pt-BR': 'Item da galeria {id}',
    fr: 'Élément de galerie {id}'
  },
  'video.videoGenerationSettings': {
    en: 'Video Generation Settings',
    es: 'Ajustes de generación de video',
    'pt-BR': 'Configurações de geração de vídeo',
    fr: 'Paramètres de génération de vidéo'
  },
  'video.videoGenerationSettingsDescription': {
    en: 'Create animated videos from a source image with motion and camera control parameters.',
    es: 'Crea videos animados a partir de una imagen de origen con parámetros de movimiento y control de cámara.',
    'pt-BR':
      'Crie vídeos animados a partir de uma imagem de origem com parâmetros de movimento e controle de câmera.',
    fr: 'Créez des vidéos animées à partir d’une image source avec des paramètres de mouvement et de contrôle de caméra.'
  },
  'video.model': {
    en: 'Model',
    es: 'Modelo',
    'pt-BR': 'Modelo',
    fr: 'Modèle'
  },
  'video.sourceImage': {
    en: 'Source Image',
    es: 'Imagen de origen',
    'pt-BR': 'Imagem de origem',
    fr: 'Image source'
  },
  'video.clickToUploadImage': {
    en: 'Click to upload an image',
    es: 'Haz clic para subir una imagen',
    'pt-BR': 'Clique para enviar uma imagem',
    fr: 'Cliquez pour téléverser une image'
  },
  'video.noFileSelected': {
    en: 'No file selected',
    es: 'Ningún archivo seleccionado',
    'pt-BR': 'Nenhum arquivo selecionado',
    fr: 'Aucun fichier sélectionné'
  },
  'video.selectedImageAlt': {
    en: 'Selected image',
    es: 'Imagen seleccionada',
    'pt-BR': 'Imagem selecionada',
    fr: 'Image sélectionnée'
  },
  'video.clearImage': {
    en: 'Clear image',
    es: 'Quitar imagen',
    'pt-BR': 'Remover imagem',
    fr: "Effacer l'image"
  },
  'video.promptOptional': {
    en: 'Prompt (Optional)',
    es: 'Instrucción (opcional)',
    'pt-BR': 'Instrução (opcional)',
    fr: 'Invite (facultatif)'
  },
  'video.aspectRatio': {
    en: 'Aspect Ratio',
    es: 'Relación de aspecto',
    'pt-BR': 'Proporção',
    fr: 'Format'
  },
  'video.aspectRatio169Landscape': {
    en: '16:9 (Landscape)',
    es: '16:9 (Horizontal)',
    'pt-BR': '16:9 (Paisagem)',
    fr: '16:9 (Paysage)'
  },
  'video.aspectRatio916Portrait': {
    en: '9:16 (Portrait)',
    es: '9:16 (Vertical)',
    'pt-BR': '9:16 (Retrato)',
    fr: '9:16 (Portrait)'
  },
  'video.aspectRatio11Square': {
    en: '1:1 (Square)',
    es: '1:1 (Cuadrada)',
    'pt-BR': '1:1 (Quadrada)',
    fr: '1:1 (Carré)'
  },
  'video.duration': {
    en: 'Duration',
    es: 'Duración',
    'pt-BR': 'Duração',
    fr: 'Durée'
  },
  'video.duration5Seconds10Tokens': {
    en: '5 seconds (10 tokens)',
    es: '5 segundos (10 tokens)',
    'pt-BR': '5 segundos (10 tokens)',
    fr: '5 secondes (10 jetons)'
  },
  'video.duration10Seconds20Tokens': {
    en: '10 seconds (20 tokens)',
    es: '10 segundos (20 tokens)',
    'pt-BR': '10 segundos (20 tokens)',
    fr: '10 secondes (20 jetons)'
  },
  'video.generateVideo': {
    en: 'Generate Video',
    es: 'Generar video',
    'pt-BR': 'Gerar vídeo',
    fr: 'Générer la vidéo'
  },
  'video.tokenAlt': {
    en: 'Token',
    es: 'Token',
    'pt-BR': 'Token',
    fr: 'Jeton'
  },
  'video.emailWhenReady': {
    en: 'Email me when my video is ready (you can close this tab)',
    es: 'Avísame por correo cuando mi video esté listo (puedes cerrar esta pestaña)',
    'pt-BR':
      'Avise-me por e-mail quando meu vídeo estiver pronto (você pode fechar esta aba)',
    fr: 'Prévenez-moi par e-mail quand ma vidéo est prête (vous pouvez fermer cet onglet)'
  },
  'video.preview': {
    en: 'Preview',
    es: 'Vista previa',
    'pt-BR': 'Pré-visualização',
    fr: 'Aperçu'
  },
  'video.generatedVideoWillAppearHere': {
    en: 'Your generated video will appear here',
    es: 'Tu video generado aparecerá aquí',
    'pt-BR': 'Seu vídeo gerado aparecerá aqui',
    fr: 'Votre vidéo générée apparaîtra ici'
  },
  'video.generationTakingLonger': {
    en: 'Generation taking longer than expected.',
    es: 'La generación está tardando más de lo esperado.',
    'pt-BR': 'A geração está demorando mais que o esperado.',
    fr: 'La génération prend plus de temps que prévu.'
  },
  'video.copyParameters': {
    en: 'Copy Parameters',
    es: 'Copiar parámetros',
    'pt-BR': 'Copiar parâmetros',
    fr: 'Copier les paramètres'
  },
  'video.openVideo': {
    en: 'Open Video',
    es: 'Abrir video',
    'pt-BR': 'Abrir vídeo',
    fr: 'Ouvrir la vidéo'
  },
  'video.downloadVideo': {
    en: 'Download Video',
    es: 'Descargar video',
    'pt-BR': 'Baixar vídeo',
    fr: 'Télécharger la vidéo'
  },
  'video.copyVideoUrl': {
    en: 'Copy Video URL',
    es: 'Copiar URL del video',
    'pt-BR': 'Copiar URL do vídeo',
    fr: "Copier l'URL de la vidéo"
  },
  'video.duration4Seconds': {
    en: '4 seconds',
    es: '4 segundos',
    'pt-BR': '4 segundos',
    fr: '4 secondes'
  },
  'video.duration5Seconds': {
    en: '5 seconds',
    es: '5 segundos',
    'pt-BR': '5 segundos',
    fr: '5 secondes'
  },
  'video.duration8Seconds': {
    en: '8 seconds',
    es: '8 segundos',
    'pt-BR': '8 segundos',
    fr: '8 secondes'
  },
  'video.duration10Seconds': {
    en: '10 seconds',
    es: '10 segundos',
    'pt-BR': '10 segundos',
    fr: '10 secondes'
  },
  'video.durationTokensLabel': {
    en: '{duration} ({cost} tokens)',
    es: '{duration} ({cost} tokens)',
    'pt-BR': '{duration} ({cost} tokens)',
    fr: '{duration} ({cost} jetons)'
  },
  'video.couldNotStartGeneration': {
    en: 'Could not start video generation',
    es: 'No se pudo iniciar la generación de video',
    'pt-BR': 'Não foi possível iniciar a geração de vídeo',
    fr: 'Impossible de démarrer la génération de vidéo'
  },
  'video.failedToGenerate': {
    en: 'Failed to generate video',
    es: 'Error al generar el video',
    'pt-BR': 'Falha ao gerar o vídeo',
    fr: 'Échec de la génération de la vidéo'
  },
  'video.pleaseSignIn': {
    en: 'Please sign in to generate videos',
    es: 'Inicia sesión para generar videos',
    'pt-BR': 'Faça login para gerar vídeos',
    fr: 'Connectez-vous pour générer des vidéos'
  },
  'video.insufficientTokens': {
    en: 'Insufficient tokens. Please purchase more tokens.',
    es: 'Tokens insuficientes. Compra más tokens.',
    'pt-BR': 'Tokens insuficientes. Compre mais tokens.',
    fr: 'Jetons insuffisants. Veuillez en acheter davantage.'
  },
  'video.noPermission': {
    en: 'You do not have permission to generate videos',
    es: 'No tienes permiso para generar videos',
    'pt-BR': 'Você não tem permissão para gerar vídeos',
    fr: "Vous n'avez pas la permission de générer des vidéos"
  },
  'video.serviceUnavailable': {
    en: 'Video generation service is temporarily unavailable. Please try again later.',
    es: 'El servicio de generación de video no está disponible temporalmente. Inténtalo de nuevo más tarde.',
    'pt-BR':
      'O serviço de geração de vídeo está temporariamente indisponível. Tente novamente mais tarde.',
    fr: 'Le service de génération de vidéo est temporairement indisponible. Réessayez plus tard.'
  },
  'video.generatedAndSaved': {
    en: 'Video generated and saved to your gallery!',
    es: '¡Video generado y guardado en tu galería!',
    'pt-BR': 'Vídeo gerado e salvo na sua galeria!',
    fr: 'Vidéo générée et enregistrée dans votre galerie !'
  },
  'video.takingLongerEmailForced': {
    en: "Video generation is taking longer than expected. We'll email you when it's ready — it will also appear in your gallery.",
    es: 'La generación del video está tardando más de lo esperado. Te enviaremos un correo cuando esté listo, y también aparecerá en tu galería.',
    'pt-BR':
      'A geração do vídeo está demorando mais que o esperado. Enviaremos um e-mail quando estiver pronto, e ele também aparecerá na sua galeria.',
    fr: "La génération de la vidéo prend plus de temps que prévu. Nous vous enverrons un e-mail dès qu'elle sera prête — elle apparaîtra aussi dans votre galerie."
  },
  'video.takingLongerCheckGallery': {
    en: 'Video generation is taking longer than expected. Check your gallery shortly — it will appear there when finished.',
    es: 'La generación del video está tardando más de lo esperado. Revisa tu galería en breve: aparecerá allí cuando termine.',
    'pt-BR':
      'A geração do vídeo está demorando mais que o esperado. Confira sua galeria em breve: ele aparecerá lá quando terminar.',
    fr: 'La génération de la vidéo prend plus de temps que prévu. Consultez votre galerie bientôt — elle y apparaîtra une fois terminée.'
  },
  'video.generationFailedWithError': {
    en: 'Video generation failed: {error}',
    es: 'Error en la generación del video: {error}',
    'pt-BR': 'Falha na geração do vídeo: {error}',
    fr: 'Échec de la génération de la vidéo : {error}'
  },
  'video.generationFailedRefunded': {
    en: 'Video generation failed. Your tokens were refunded.',
    es: 'Error en la generación del video. Se reembolsaron tus tokens.',
    'pt-BR': 'Falha na geração do vídeo. Seus tokens foram reembolsados.',
    fr: 'Échec de la génération de la vidéo. Vos jetons ont été remboursés.'
  },
  'video.pleaseUploadImage': {
    en: 'Please upload a reference image',
    es: 'Sube una imagen de referencia',
    'pt-BR': 'Envie uma imagem de referência',
    fr: 'Veuillez téléverser une image de référence'
  },
  'video.generating': {
    en: 'Generating...',
    es: 'Generando...',
    'pt-BR': 'Gerando...',
    fr: 'Génération...'
  },
  'video.noVideoToOpen': {
    en: 'No video to open',
    es: 'No hay video para abrir',
    'pt-BR': 'Nenhum vídeo para abrir',
    fr: 'Aucune vidéo à ouvrir'
  },
  'video.videoOpened': {
    en: 'Video opened in new tab!',
    es: '¡Video abierto en una pestaña nueva!',
    'pt-BR': 'Vídeo aberto em nova aba!',
    fr: 'Vidéo ouverte dans un nouvel onglet !'
  },
  'video.noVideoToDownload': {
    en: 'No video to download',
    es: 'No hay video para descargar',
    'pt-BR': 'Nenhum vídeo para baixar',
    fr: 'Aucune vidéo à télécharger'
  },
  'video.videoDownloadStarted': {
    en: 'Video download started!',
    es: '¡Descarga de video iniciada!',
    'pt-BR': 'Download do vídeo iniciado!',
    fr: 'Téléchargement de la vidéo démarré !'
  },
  'video.noVideoUrlToCopy': {
    en: 'No video URL to copy',
    es: 'No hay URL de video para copiar',
    'pt-BR': 'Nenhuma URL de vídeo para copiar',
    fr: 'Aucune URL de vidéo à copier'
  },
  'video.videoUrlCopied': {
    en: 'Video URL copied to clipboard!',
    es: '¡URL del video copiada al portapapeles!',
    'pt-BR': 'URL do vídeo copiada para a área de transferência!',
    fr: 'URL de la vidéo copiée dans le presse-papiers !'
  },
  'video.failedToCopyUrl': {
    en: 'Failed to copy URL: {error}',
    es: 'Error al copiar la URL: {error}',
    'pt-BR': 'Falha ao copiar a URL: {error}',
    fr: "Échec de la copie de l'URL : {error}"
  },
  'video.noParametersToCopy': {
    en: 'No parameters to copy',
    es: 'No hay parámetros para copiar',
    'pt-BR': 'Nenhum parâmetro para copiar',
    fr: 'Aucun paramètre à copier'
  },
  'video.parametersCopied': {
    en: 'Parameters copied to clipboard!',
    es: '¡Parámetros copiados al portapapeles!',
    'pt-BR': 'Parâmetros copiados para a área de transferência!',
    fr: 'Paramètres copiés dans le presse-papiers !'
  },
  'video.failedToCopyParameters': {
    en: 'Failed to copy parameters: {error}',
    es: 'Error al copiar los parámetros: {error}',
    'pt-BR': 'Falha ao copiar os parâmetros: {error}',
    fr: 'Échec de la copie des paramètres : {error}'
  },
  'video.fromGallery': {
    en: 'From Gallery',
    es: 'De la galería',
    'pt-BR': 'Da galeria',
    fr: 'Depuis la galerie'
  },

  // ── Splat tab (splat.js) ────────────────────────────────────────────────
  // The two research-preview notices carry HTML (<a> links) that must survive
  // verbatim, so they use backtick literals; only the surrounding prose is
  // translated. Product/technical tokens (Splat, SHARP, vid2scene, .ply,
  // Apache-2.0, the license proper-name) are intentionally left in English.
  'splat.vid2sceneNotice': {
    en: `Research preview. Splats are generated with the open-source <a href="https://github.com/samuelm2/vid2scene" target="_blank" rel="noopener" class="underline hover:text-gray-600">vid2scene</a> pipeline (Apache-2.0). For best results, capture a slow, steady orbit around a static subject in good lighting. Token charges cover our inference-provider costs.`,
    es: `Vista previa de investigación. Los splats se generan con el pipeline de código abierto <a href="https://github.com/samuelm2/vid2scene" target="_blank" rel="noopener" class="underline hover:text-gray-600">vid2scene</a> (Apache-2.0). Para mejores resultados, captura una órbita lenta y estable alrededor de un sujeto estático con buena iluminación. Los cargos de tokens cubren los costos de nuestro proveedor de inferencia.`,
    'pt-BR': `Prévia de pesquisa. Os splats são gerados com o pipeline de código aberto <a href="https://github.com/samuelm2/vid2scene" target="_blank" rel="noopener" class="underline hover:text-gray-600">vid2scene</a> (Apache-2.0). Para melhores resultados, capture uma órbita lenta e estável ao redor de um objeto estático com boa iluminação. As cobranças de tokens cobrem os custos do nosso provedor de inferência.`,
    fr: `Aperçu de recherche. Les splats sont générés avec le pipeline open source <a href="https://github.com/samuelm2/vid2scene" target="_blank" rel="noopener" class="underline hover:text-gray-600">vid2scene</a> (Apache-2.0). Pour de meilleurs résultats, capturez une orbite lente et régulière autour d’un sujet statique bien éclairé. Les frais de jetons couvrent les coûts de notre fournisseur d’inférence.`
  },
  'splat.noticeSharp': {
    en: `Research preview. Splats are generated with Apple's SHARP model. By generating a splat you accept the terms of the <a href="https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL" target="_blank" rel="noopener" class="underline hover:text-gray-600">Apple Machine Learning Research Model License</a> and agree this output is provided for research purposes only. Token charges cover our inference-provider costs; this is not a primary commercial service.`,
    es: `Vista previa de investigación. Los splats se generan con el modelo SHARP de Apple. Al generar un splat, aceptas los términos de la <a href="https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL" target="_blank" rel="noopener" class="underline hover:text-gray-600">Apple Machine Learning Research Model License</a> y reconoces que este resultado se proporciona solo con fines de investigación. Los cargos de tokens cubren los costos de nuestro proveedor de inferencia; este no es un servicio comercial principal.`,
    'pt-BR': `Prévia de pesquisa. Os splats são gerados com o modelo SHARP da Apple. Ao gerar um splat, você aceita os termos da <a href="https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL" target="_blank" rel="noopener" class="underline hover:text-gray-600">Apple Machine Learning Research Model License</a> e concorda que este resultado é fornecido apenas para fins de pesquisa. As cobranças de tokens cobrem os custos do nosso provedor de inferência; este não é um serviço comercial principal.`,
    fr: `Aperçu de recherche. Les splats sont générés avec le modèle SHARP d’Apple. En générant un splat, vous acceptez les termes de la <a href="https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL" target="_blank" rel="noopener" class="underline hover:text-gray-600">Apple Machine Learning Research Model License</a> et convenez que ce résultat est fourni à des fins de recherche uniquement. Les frais de jetons couvrent les coûts de notre fournisseur d’inférence ; il ne s’agit pas d’un service commercial principal.`
  },
  'splat.modelSharpLabel': {
    en: 'Image → Splat (SHARP)',
    es: 'Imagen → Splat (SHARP)',
    'pt-BR': 'Imagem → Splat (SHARP)',
    fr: 'Image → Splat (SHARP)'
  },
  'splat.etaAboutFiveMinutes': {
    en: 'about 5 minutes',
    es: 'unos 5 minutos',
    'pt-BR': 'cerca de 5 minutos',
    fr: 'environ 5 minutes'
  },
  'splat.blurbSharp': {
    en: 'Model: SHARP (Apple) · single image · outputs a .ply splat. Generation usually takes about 5 minutes.',
    es: 'Modelo: SHARP (Apple) · una sola imagen · genera un splat .ply. La generación suele tardar unos 5 minutos.',
    'pt-BR':
      'Modelo: SHARP (Apple) · uma única imagem · gera um splat .ply. A geração costuma levar cerca de 5 minutos.',
    fr: 'Modèle : SHARP (Apple) · une seule image · produit un splat .ply. La génération prend généralement environ 5 minutes.'
  },
  'splat.modelVid2sceneBasicLabel': {
    en: 'Video → Splat (vid2scene Basic)',
    es: 'Video → Splat (vid2scene Basic)',
    'pt-BR': 'Vídeo → Splat (vid2scene Basic)',
    fr: 'Vidéo → Splat (vid2scene Basic)'
  },
  'splat.tierBasic': {
    en: 'Basic',
    es: 'Básico',
    'pt-BR': 'Básico',
    fr: 'Basique'
  },
  'splat.videoHintBasic': {
    en: '~10–25s video',
    es: 'video de ~10–25 s',
    'pt-BR': 'vídeo de ~10–25 s',
    fr: 'vidéo de ~10–25 s'
  },
  'splat.etaAboutThirtyMinutes': {
    en: 'about 30 minutes',
    es: 'unos 30 minutos',
    'pt-BR': 'cerca de 30 minutos',
    fr: 'environ 30 minutes'
  },
  'splat.blurbVid2sceneBasic': {
    en: 'Model: vid2scene Basic · best for a ~10–25 second orbit of a single object · preview-grade detail, usually ready in ~30 minutes.',
    es: 'Modelo: vid2scene Basic · ideal para una órbita de ~10–25 segundos de un solo objeto · detalle de nivel de vista previa, normalmente listo en ~30 minutos.',
    'pt-BR':
      'Modelo: vid2scene Basic · ideal para uma órbita de ~10–25 segundos de um único objeto · detalhe em nível de prévia, geralmente pronto em ~30 minutos.',
    fr: 'Modèle : vid2scene Basic · idéal pour une orbite de ~10–25 secondes d’un seul objet · détail de niveau aperçu, généralement prêt en ~30 minutes.'
  },
  'splat.modelVid2sceneHighLabel': {
    en: 'Video → Splat (vid2scene High)',
    es: 'Video → Splat (vid2scene High)',
    'pt-BR': 'Vídeo → Splat (vid2scene High)',
    fr: 'Vidéo → Splat (vid2scene High)'
  },
  'splat.modelVid2sceneGroupLabel': {
    en: 'Video → Splat (vid2scene)',
    es: 'Video → Splat (vid2scene)',
    'pt-BR': 'Vídeo → Splat (vid2scene)',
    fr: 'Vidéo → Splat (vid2scene)'
  },
  'splat.tierHigh': {
    en: 'High',
    es: 'Alto',
    'pt-BR': 'Alto',
    fr: 'Élevé'
  },
  'splat.videoHintHigh': {
    en: '~15–40s video',
    es: 'video de ~15–40 s',
    'pt-BR': 'vídeo de ~15–40 s',
    fr: 'vidéo de ~15–40 s'
  },
  'splat.etaAboutAnHour': {
    en: 'about an hour',
    es: 'alrededor de una hora',
    'pt-BR': 'cerca de uma hora',
    fr: 'environ une heure'
  },
  'splat.blurbVid2sceneHigh': {
    en: 'Model: vid2scene High · best for a ~15–40 second orbit of a larger subject or small scene · the recommended balance of detail and time, usually about an hour.',
    es: 'Modelo: vid2scene High · ideal para una órbita de ~15–40 segundos de un sujeto más grande o una escena pequeña · el equilibrio recomendado entre detalle y tiempo, normalmente alrededor de una hora.',
    'pt-BR':
      'Modelo: vid2scene High · ideal para uma órbita de ~15–40 segundos de um objeto maior ou uma cena pequena · o equilíbrio recomendado entre detalhe e tempo, geralmente cerca de uma hora.',
    fr: 'Modèle : vid2scene High · idéal pour une orbite de ~15–40 secondes d’un sujet plus grand ou d’une petite scène · l’équilibre recommandé entre détail et temps, généralement environ une heure.'
  },
  'splat.modelVid2sceneMaxLabel': {
    en: 'Video → Splat (vid2scene Max)',
    es: 'Video → Splat (vid2scene Max)',
    'pt-BR': 'Vídeo → Splat (vid2scene Max)',
    fr: 'Vidéo → Splat (vid2scene Max)'
  },
  'splat.tierMax': {
    en: 'Max',
    es: 'Max',
    'pt-BR': 'Max',
    fr: 'Max'
  },
  'splat.videoHintMax': {
    en: '~50–90s video',
    es: 'video de ~50–90 s',
    'pt-BR': 'vídeo de ~50–90 s',
    fr: 'vidéo de ~50–90 s'
  },
  'splat.etaOneToTwoHours': {
    en: '1–2 hours',
    es: '1–2 horas',
    'pt-BR': '1–2 horas',
    fr: '1–2 heures'
  },
  'splat.blurbVid2sceneMax': {
    en: 'Model: vid2scene Max · best for a ~50–90 second sweep of a large scene · maximum detail (4x the gaussians, large file), can take 1–2 hours.',
    es: 'Modelo: vid2scene Max · ideal para un barrido de ~50–90 segundos de una escena grande · detalle máximo (4× los gaussianos, archivo grande), puede tardar 1–2 horas.',
    'pt-BR':
      'Modelo: vid2scene Max · ideal para uma varredura de ~50–90 segundos de uma cena grande · detalhe máximo (4× os gaussianos, arquivo grande), pode levar 1–2 horas.',
    fr: 'Modèle : vid2scene Max · idéal pour un balayage de ~50–90 secondes d’une grande scène · détail maximal (4× les gaussiennes, fichier volumineux), peut prendre 1–2 heures.'
  },
  'splat.tokensCount': {
    en: '{count} tokens',
    es: '{count} tokens',
    'pt-BR': '{count} tokens',
    fr: '{count} jetons'
  },
  'splat.createSplatHeading': {
    en: 'Create a Splat',
    es: 'Crear un splat',
    'pt-BR': 'Criar um splat',
    fr: 'Créer un splat'
  },
  'splat.createSplatDescription': {
    en: 'Turn a photo or a short video into a 3D Gaussian Splat you can place in your scene.',
    es: 'Convierte una foto o un video corto en un splat gaussiano 3D que puedes colocar en tu escena.',
    'pt-BR':
      'Transforme uma foto ou um vídeo curto em um splat gaussiano 3D que você pode colocar na sua cena.',
    fr: 'Transformez une photo ou une courte vidéo en un splat gaussien 3D que vous pouvez placer dans votre scène.'
  },
  'splat.modelLabel': {
    en: 'Model',
    es: 'Modelo',
    'pt-BR': 'Modelo',
    fr: 'Modèle'
  },
  'splat.sourceImageLabel': {
    en: 'Source Image',
    es: 'Imagen de origen',
    'pt-BR': 'Imagem de origem',
    fr: 'Image source'
  },
  'splat.imageUploadPrompt': {
    en: 'Click or drop an image to upload',
    es: 'Haz clic o arrastra una imagen para subirla',
    'pt-BR': 'Clique ou solte uma imagem para enviar',
    fr: 'Cliquez ou déposez une image à téléverser'
  },
  'splat.noFileSelected': {
    en: 'No file selected',
    es: 'Ningún archivo seleccionado',
    'pt-BR': 'Nenhum arquivo selecionado',
    fr: 'Aucun fichier sélectionné'
  },
  'splat.selectedImageAlt': {
    en: 'Selected image',
    es: 'Imagen seleccionada',
    'pt-BR': 'Imagem selecionada',
    fr: 'Image sélectionnée'
  },
  'splat.clearImageTitle': {
    en: 'Clear image',
    es: 'Quitar imagen',
    'pt-BR': 'Remover imagem',
    fr: "Effacer l'image"
  },
  'splat.sourceVideoLabel': {
    en: 'Source Video',
    es: 'Video de origen',
    'pt-BR': 'Vídeo de origem',
    fr: 'Vidéo source'
  },
  'splat.videoUploadPrompt': {
    en: 'Click to choose a video to upload',
    es: 'Haz clic para elegir un video que subir',
    'pt-BR': 'Clique para escolher um vídeo para enviar',
    fr: 'Cliquez pour choisir une vidéo à téléverser'
  },
  'splat.clearVideoTitle': {
    en: 'Clear video',
    es: 'Quitar video',
    'pt-BR': 'Remover vídeo',
    fr: 'Effacer la vidéo'
  },
  'splat.qualityLabel': {
    en: 'Quality',
    es: 'Calidad',
    'pt-BR': 'Qualidade',
    fr: 'Qualité'
  },
  'splat.generateSplat': {
    en: 'Generate Splat',
    es: 'Generar splat',
    'pt-BR': 'Gerar splat',
    fr: 'Générer le splat'
  },
  'splat.emailWhenReady': {
    en: 'Email me when my splat is ready (you can close this tab)',
    es: 'Avísame por correo cuando mi splat esté listo (puedes cerrar esta pestaña)',
    'pt-BR':
      'Avise-me por e-mail quando meu splat estiver pronto (você pode fechar esta aba)',
    fr: 'Prévenez-moi par e-mail quand mon splat est prêt (vous pouvez fermer cet onglet)'
  },
  'splat.resultHeading': {
    en: 'Result',
    es: 'Resultado',
    'pt-BR': 'Resultado',
    fr: 'Résultat'
  },
  'splat.placeholderText': {
    en: 'Choose a source, then generate a splat.',
    es: 'Elige una fuente y luego genera un splat.',
    'pt-BR': 'Escolha uma fonte e depois gere um splat.',
    fr: 'Choisissez une source, puis générez un splat.'
  },
  'splat.uploading': {
    en: 'Uploading…',
    es: 'Subiendo…',
    'pt-BR': 'Enviando…',
    fr: 'Téléversement…'
  },
  'splat.loadingSubtextDefault': {
    en: "This can take a few minutes. You can close this tab; your splat saves to your gallery when it's done.",
    es: 'Esto puede tardar unos minutos. Puedes cerrar esta pestaña; tu splat se guardará en tu galería cuando termine.',
    'pt-BR':
      'Isto pode levar alguns minutos. Você pode fechar esta aba; seu splat será salvo na sua galeria quando terminar.',
    fr: 'Cela peut prendre quelques minutes. Vous pouvez fermer cet onglet ; votre splat sera enregistré dans votre galerie une fois terminé.'
  },
  'splat.viewerFrameTitle': {
    en: 'Splat preview',
    es: 'Vista previa del splat',
    'pt-BR': 'Pré-visualização do splat',
    fr: 'Aperçu du splat'
  },
  'splat.resultHint': {
    en: 'Drag to orbit · scroll to zoom. Saved to your gallery — open it in the editor and drag it into a scene.',
    es: 'Arrastra para orbitar · desplázate para hacer zoom. Guardado en tu galería: ábrelo en el editor y arrástralo a una escena.',
    'pt-BR':
      'Arraste para orbitar · role para dar zoom. Salvo na sua galeria: abra-o no editor e arraste-o para uma cena.',
    fr: 'Faites glisser pour orbiter · faites défiler pour zoomer. Enregistré dans votre galerie — ouvrez-le dans l’éditeur et faites-le glisser dans une scène.'
  },
  'splat.openInEditor': {
    en: 'Open in 3DStreet',
    es: 'Abrir en 3DStreet',
    'pt-BR': 'Abrir no 3DStreet',
    fr: 'Ouvrir dans 3DStreet'
  },
  'splat.download': {
    en: 'Download',
    es: 'Descargar',
    'pt-BR': 'Baixar',
    fr: 'Télécharger'
  },
  'splat.generateSplatWithTokens': {
    en: 'Generate Splat ({count} tokens)',
    es: 'Generar splat ({count} tokens)',
    'pt-BR': 'Gerar splat ({count} tokens)',
    fr: 'Générer le splat ({count} jetons)'
  },
  'splat.defaultImageFilename': {
    en: 'image',
    es: 'imagen',
    'pt-BR': 'imagem',
    fr: 'image'
  },
  'splat.videoTooLargeFallback': {
    en: 'Video is too large (max {maxMb} MB). Trim it to a short orbit and try again.',
    es: 'El video es demasiado grande (máx. {maxMb} MB). Recórtalo a una órbita corta e inténtalo de nuevo.',
    'pt-BR':
      'O vídeo é muito grande (máx. {maxMb} MB). Corte-o para uma órbita curta e tente novamente.',
    fr: 'La vidéo est trop volumineuse (max {maxMb} Mo). Réduisez-la à une courte orbite et réessayez.'
  },
  'splat.videoTooLargeForPlan': {
    en: 'This video is {fileMb} MB; the {planName} plan allows {limitMb} MB per file. Upgrade for larger uploads, or trim the video to a shorter orbit.',
    es: 'Este video pesa {fileMb} MB; el plan {planName} permite {limitMb} MB por archivo. Mejora tu plan para subir archivos más grandes o recorta el video a una órbita más corta.',
    'pt-BR':
      'Este vídeo tem {fileMb} MB; o plano {planName} permite {limitMb} MB por arquivo. Faça upgrade para envios maiores ou corte o vídeo para uma órbita mais curta.',
    fr: 'Cette vidéo fait {fileMb} Mo ; le forfait {planName} autorise {limitMb} Mo par fichier. Passez à un forfait supérieur pour des envois plus volumineux, ou réduisez la vidéo à une orbite plus courte.'
  },
  'splat.chooseSourceVideoFirst': {
    en: 'Please choose a source video first.',
    es: 'Primero elige un video de origen.',
    'pt-BR': 'Primeiro escolha um vídeo de origem.',
    fr: "Veuillez d'abord choisir une vidéo source."
  },
  'splat.uploadSourceImageFirst': {
    en: 'Please upload a source image first.',
    es: 'Primero sube una imagen de origen.',
    'pt-BR': 'Primeiro envie uma imagem de origem.',
    fr: "Veuillez d'abord téléverser une image source."
  },
  'splat.generating': {
    en: 'Generating…',
    es: 'Generando…',
    'pt-BR': 'Gerando…',
    fr: 'Génération…'
  },
  'splat.etaFewMinutes': {
    en: 'a few minutes',
    es: 'unos minutos',
    'pt-BR': 'alguns minutos',
    fr: 'quelques minutes'
  },
  'splat.loadingSubtextProcessing': {
    en: "This usually takes {eta}. You can close this tab; your splat saves to your gallery when it's done.",
    es: 'Esto suele tardar {eta}. Puedes cerrar esta pestaña; tu splat se guardará en tu galería cuando termine.',
    'pt-BR':
      'Isto normalmente leva {eta}. Você pode fechar esta aba; seu splat será salvo na sua galeria quando terminar.',
    fr: 'Cela prend généralement {eta}. Vous pouvez fermer cet onglet ; votre splat sera enregistré dans votre galerie une fois terminé.'
  },
  'splat.generatingSplatTimer': {
    en: 'Generating splat… {time}',
    es: 'Generando splat… {time}',
    'pt-BR': 'Gerando splat… {time}',
    fr: 'Génération du splat… {time}'
  },
  'splat.notSignedIn': {
    en: 'Not signed in',
    es: 'Sesión no iniciada',
    'pt-BR': 'Não conectado',
    fr: 'Non connecté'
  },
  'splat.uploadingVideoPct': {
    en: 'Uploading video… {pct}%',
    es: 'Subiendo video… {pct}%',
    'pt-BR': 'Enviando vídeo… {pct}%',
    fr: 'Téléversement de la vidéo… {pct}%'
  },
  'splat.couldNotStart': {
    en: 'Could not start splat generation',
    es: 'No se pudo iniciar la generación del splat',
    'pt-BR': 'Não foi possível iniciar a geração do splat',
    fr: 'Impossible de démarrer la génération du splat'
  },
  'splat.splatGenerated': {
    en: 'Splat generated!',
    es: '¡Splat generado!',
    'pt-BR': 'Splat gerado!',
    fr: 'Splat généré !'
  },
  'splat.timedOutEmailForced': {
    en: "Splat generation is taking longer than expected. We'll email you when it's ready — it will also appear in your gallery.",
    es: 'La generación del splat está tardando más de lo esperado. Te enviaremos un correo cuando esté listo, y también aparecerá en tu galería.',
    'pt-BR':
      'A geração do splat está demorando mais que o esperado. Enviaremos um e-mail quando estiver pronto, e ele também aparecerá na sua galeria.',
    fr: "La génération du splat prend plus de temps que prévu. Nous vous enverrons un e-mail dès qu'il sera prêt — il apparaîtra aussi dans votre galerie."
  },
  'splat.timedOutCheckGallery': {
    en: 'Splat generation is taking longer than expected. Check your gallery shortly.',
    es: 'La generación del splat está tardando más de lo esperado. Revisa tu galería en breve.',
    'pt-BR':
      'A geração do splat está demorando mais que o esperado. Confira sua galeria em breve.',
    fr: 'La génération du splat prend plus de temps que prévu. Consultez votre galerie bientôt.'
  },
  'splat.generationFailedWithError': {
    en: 'Splat generation failed: {error}',
    es: 'Error en la generación del splat: {error}',
    'pt-BR': 'Falha na geração do splat: {error}',
    fr: 'Échec de la génération du splat : {error}'
  },
  'splat.generationFailedRefunded': {
    en: 'Splat generation failed. Your tokens were refunded.',
    es: 'Error en la generación del splat. Se reembolsaron tus tokens.',
    'pt-BR': 'Falha na geração do splat. Seus tokens foram reembolsados.',
    fr: 'Échec de la génération du splat. Vos jetons ont été remboursés.'
  },
  'splat.errorSignIn': {
    en: 'Please sign in to generate splats',
    es: 'Inicia sesión para generar splats',
    'pt-BR': 'Faça login para gerar splats',
    fr: 'Connectez-vous pour générer des splats'
  },
  'splat.errorNoTokens': {
    en: 'No tokens available. Please purchase more tokens.',
    es: 'No hay tokens disponibles. Compra más tokens.',
    'pt-BR': 'Nenhum token disponível. Compre mais tokens.',
    fr: 'Aucun jeton disponible. Veuillez en acheter davantage.'
  },
  'splat.errorFailedWithMessage': {
    en: 'Failed to generate splat: {message}',
    es: 'Error al generar el splat: {message}',
    'pt-BR': 'Falha ao gerar o splat: {message}',
    fr: 'Échec de la génération du splat : {message}'
  },
  'splat.errorFailed': {
    en: 'Failed to generate splat',
    es: 'Error al generar el splat',
    'pt-BR': 'Falha ao gerar o splat',
    fr: 'Échec de la génération du splat'
  },

  // ── 3D Model tab (model3d.js) ───────────────────────────────────────────
  // Brand model names (Hunyuan3D, TRELLIS) stay; only the parenthetical
  // qualifier is translated.
  'model3d.modelHunyuanName': {
    en: 'Hunyuan3D v2 (faster)',
    es: 'Hunyuan3D v2 (más rápido)',
    'pt-BR': 'Hunyuan3D v2 (mais rápido)',
    fr: 'Hunyuan3D v2 (plus rapide)'
  },
  'model3d.modelTrellisName': {
    en: 'TRELLIS 2 (best quality)',
    es: 'TRELLIS 2 (mejor calidad)',
    'pt-BR': 'TRELLIS 2 (melhor qualidade)',
    fr: 'TRELLIS 2 (meilleure qualité)'
  },
  'model3d.settingsHeading': {
    en: '3D Model Settings',
    es: 'Ajustes del modelo 3D',
    'pt-BR': 'Configurações do modelo 3D',
    fr: 'Paramètres du modèle 3D'
  },
  'model3d.settingsDescription': {
    en: 'Generate a 3D mesh (GLB) from a reference image. Best for placemaking objects and props: shelters, kiosks, benches, bollards, wayfinding, vehicles.',
    es: 'Genera una malla 3D (GLB) a partir de una imagen de referencia. Ideal para objetos y elementos de urbanismo: marquesinas, quioscos, bancos, bolardos, señalización y vehículos.',
    'pt-BR':
      'Gere uma malha 3D (GLB) a partir de uma imagem de referência. Ideal para objetos e elementos urbanos: abrigos, quiosques, bancos, balizadores, sinalização e veículos.',
    fr: 'Générez un maillage 3D (GLB) à partir d’une image de référence. Idéal pour les objets et accessoires d’aménagement : abris, kiosques, bancs, bornes, signalétique, véhicules.'
  },
  'model3d.modelLabel': {
    en: 'Model',
    es: 'Modelo',
    'pt-BR': 'Modelo',
    fr: 'Modèle'
  },
  'model3d.referenceImageLabel': {
    en: 'Reference Image',
    es: 'Imagen de referencia',
    'pt-BR': 'Imagem de referência',
    fr: 'Image de référence'
  },
  'model3d.requiredTooltip': {
    en: 'Required',
    es: 'Obligatorio',
    'pt-BR': 'Obrigatório',
    fr: 'Requis'
  },
  'model3d.clickToUpload': {
    en: 'Click to upload an image',
    es: 'Haz clic para subir una imagen',
    'pt-BR': 'Clique para enviar uma imagem',
    fr: 'Cliquez pour téléverser une image'
  },
  'model3d.noFileSelected': {
    en: 'No file selected',
    es: 'Ningún archivo seleccionado',
    'pt-BR': 'Nenhum arquivo selecionado',
    fr: 'Aucun fichier sélectionné'
  },
  'model3d.referenceImageAlt': {
    en: 'Reference image',
    es: 'Imagen de referencia',
    'pt-BR': 'Imagem de referência',
    fr: 'Image de référence'
  },
  'model3d.clearImageTooltip': {
    en: 'Clear image',
    es: 'Quitar imagen',
    'pt-BR': 'Remover imagem',
    fr: "Effacer l'image"
  },
  'model3d.referenceImageHelp': {
    en: 'Required: these models generate a 3D mesh from a reference image.',
    es: 'Obligatorio: estos modelos generan una malla 3D a partir de una imagen de referencia.',
    'pt-BR':
      'Obrigatório: estes modelos geram uma malha 3D a partir de uma imagem de referência.',
    fr: 'Requis : ces modèles génèrent un maillage 3D à partir d’une image de référence.'
  },
  'model3d.generateButton': {
    en: 'Generate 3D Model',
    es: 'Generar modelo 3D',
    'pt-BR': 'Gerar modelo 3D',
    fr: 'Générer le modèle 3D'
  },
  'model3d.tokenAlt': {
    en: 'Token',
    es: 'Token',
    'pt-BR': 'Token',
    fr: 'Jeton'
  },
  'model3d.notifyEmailLabel': {
    en: 'Email me when my 3D model is ready (you can close this tab)',
    es: 'Avísame por correo cuando mi modelo 3D esté listo (puedes cerrar esta pestaña)',
    'pt-BR':
      'Avise-me por e-mail quando meu modelo 3D estiver pronto (você pode fechar esta aba)',
    fr: 'Prévenez-moi par e-mail quand mon modèle 3D est prêt (vous pouvez fermer cet onglet)'
  },
  'model3d.previewHeading': {
    en: 'Preview',
    es: 'Vista previa',
    'pt-BR': 'Pré-visualização',
    fr: 'Aperçu'
  },
  'model3d.placeholderText': {
    en: 'Your generated 3D model (GLB) will appear here',
    es: 'Tu modelo 3D generado (GLB) aparecerá aquí',
    'pt-BR': 'Seu modelo 3D gerado (GLB) aparecerá aqui',
    fr: 'Votre modèle 3D généré (GLB) apparaîtra ici'
  },
  'model3d.loadingText': {
    en: 'Generating your 3D model...',
    es: 'Generando tu modelo 3D...',
    'pt-BR': 'Gerando seu modelo 3D...',
    fr: 'Génération de votre modèle 3D...'
  },
  'model3d.viewerFrameTitle': {
    en: '3D model preview',
    es: 'Vista previa del modelo 3D',
    'pt-BR': 'Pré-visualização do modelo 3D',
    fr: 'Aperçu du modèle 3D'
  },
  'model3d.resultHelp': {
    en: 'Drag to orbit · scroll to zoom. Saved to your gallery; open it in the editor and drag it into a scene.',
    es: 'Arrastra para orbitar · desplázate para hacer zoom. Guardado en tu galería; ábrelo en el editor y arrástralo a una escena.',
    'pt-BR':
      'Arraste para orbitar · role para dar zoom. Salvo na sua galeria; abra-o no editor e arraste-o para uma cena.',
    fr: 'Faites glisser pour orbiter · faites défiler pour zoomer. Enregistré dans votre galerie ; ouvrez-le dans l’éditeur et faites-le glisser dans une scène.'
  },
  'model3d.openInEditor': {
    en: 'Open in 3DStreet',
    es: 'Abrir en 3DStreet',
    'pt-BR': 'Abrir no 3DStreet',
    fr: 'Ouvrir dans 3DStreet'
  },
  'model3d.downloadButton': {
    en: 'Download',
    es: 'Descargar',
    'pt-BR': 'Baixar',
    fr: 'Télécharger'
  },
  'model3d.addReferenceImageWarning': {
    en: 'Add a reference image to generate a 3D model with this model.',
    es: 'Añade una imagen de referencia para generar un modelo 3D con este modelo.',
    'pt-BR':
      'Adicione uma imagem de referência para gerar um modelo 3D com este modelo.',
    fr: 'Ajoutez une image de référence pour générer un modèle 3D avec ce modèle.'
  },
  'model3d.couldNotStart': {
    en: 'Could not start 3D generation',
    es: 'No se pudo iniciar la generación 3D',
    'pt-BR': 'Não foi possível iniciar a geração 3D',
    fr: 'Impossible de démarrer la génération 3D'
  },
  'model3d.generatedSuccess': {
    en: '3D model generated!',
    es: '¡Modelo 3D generado!',
    'pt-BR': 'Modelo 3D gerado!',
    fr: 'Modèle 3D généré !'
  },
  'model3d.timeoutForcedEmail': {
    en: "3D generation is taking longer than expected. We'll email you when it's ready — it will also appear in your gallery.",
    es: 'La generación 3D está tardando más de lo esperado. Te enviaremos un correo cuando esté listo, y también aparecerá en tu galería.',
    'pt-BR':
      'A geração 3D está demorando mais que o esperado. Enviaremos um e-mail quando estiver pronto, e ele também aparecerá na sua galeria.',
    fr: "La génération 3D prend plus de temps que prévu. Nous vous enverrons un e-mail dès qu'il sera prêt — il apparaîtra aussi dans votre galerie."
  },
  'model3d.timeoutCheckGallery': {
    en: '3D generation is taking longer than expected. Check your gallery shortly.',
    es: 'La generación 3D está tardando más de lo esperado. Revisa tu galería en breve.',
    'pt-BR':
      'A geração 3D está demorando mais que o esperado. Confira sua galeria em breve.',
    fr: 'La génération 3D prend plus de temps que prévu. Consultez votre galerie bientôt.'
  },
  'model3d.generationFailedWithReason': {
    en: '3D generation failed: {jobError}',
    es: 'Error en la generación 3D: {jobError}',
    'pt-BR': 'Falha na geração 3D: {jobError}',
    fr: 'Échec de la génération 3D : {jobError}'
  },
  'model3d.generationFailedRefunded': {
    en: '3D generation failed. Your tokens were refunded.',
    es: 'Error en la generación 3D. Se reembolsaron tus tokens.',
    'pt-BR': 'Falha na geração 3D. Seus tokens foram reembolsados.',
    fr: 'Échec de la génération 3D. Vos jetons ont été remboursés.'
  },
  'model3d.errorSignIn': {
    en: 'Please sign in to generate 3D models',
    es: 'Inicia sesión para generar modelos 3D',
    'pt-BR': 'Faça login para gerar modelos 3D',
    fr: 'Connectez-vous pour générer des modèles 3D'
  },
  'model3d.errorNoTokens': {
    en: 'No tokens available. Please purchase more tokens or upgrade to Pro.',
    es: 'No hay tokens disponibles. Compra más tokens o mejora a Pro.',
    'pt-BR':
      'Nenhum token disponível. Compre mais tokens ou faça upgrade para o Pro.',
    fr: 'Aucun jeton disponible. Achetez plus de jetons ou passez à Pro.'
  },
  'model3d.errorFailedWithReason': {
    en: 'Failed to generate 3D model: {message}',
    es: 'Error al generar el modelo 3D: {message}',
    'pt-BR': 'Falha ao gerar o modelo 3D: {message}',
    fr: 'Échec de la génération du modèle 3D : {message}'
  },
  'model3d.errorFailed': {
    en: 'Failed to generate 3D model',
    es: 'Error al generar el modelo 3D',
    'pt-BR': 'Falha ao gerar o modelo 3D',
    fr: 'Échec de la génération du modèle 3D'
  },
  'model3d.generatingButton': {
    en: 'Generating...',
    es: 'Generando...',
    'pt-BR': 'Gerando...',
    fr: 'Génération...'
  },
  'model3d.timerProgress': {
    en: '{elapsed}s/{estimated}s',
    es: '{elapsed}s/{estimated}s',
    'pt-BR': '{elapsed}s/{estimated}s',
    fr: '{elapsed}s/{estimated}s'
  }
};

/**
 * Resolves a generator message id to the active locale's string, interpolating
 * simple {placeholder} values. Unknown ids return the id itself (loud enough to
 * spot in the UI, safe enough not to crash) — mirrors formatSharedMessage.
 */
export function t(id, values, { locale = getActiveLocale() } = {}) {
  const entry = MESSAGES[id];
  if (!entry) return id;
  const template = entry[locale] || entry[DEFAULT_LOCALE];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in values ? String(values[key]) : match
  );
}

export default t;
