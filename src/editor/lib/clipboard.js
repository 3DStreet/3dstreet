/* global AFRAME, STREET */
/**
 * Clipboard support for streets, segments and entities (issue #1491).
 *
 * Copy serializes the selected entity with STREET.utils.getElementData — the
 * same format the save/load pipeline uses — wrapped in a small JSON envelope,
 * and writes it to the system clipboard so scenes in other tabs/windows can
 * paste it. Following https://alexharri.com/blog/clipboard, the payload is
 * written both as `text/html` (JSON smuggled base64-encoded in a data
 * attribute, which survives clipboard HTML sanitizers) and as `text/plain`
 * (raw JSON, readable anywhere and useful for debugging).
 *
 * Paste recreates the entity through the undoable `entitypaste` command:
 *   - a street pastes into #street-container (the default layer parent)
 *   - a segment pastes after the selected segment, or into the selected /
 *     containing street, or into the scene's first street as a last resort
 *   - anything else pastes into #street-container
 *
 * Copy itself never touches undo history; Cut is a Copy plus the existing
 * undoable `entityremove` command.
 */
import { createUniqueId } from './entity.js';

const CLIPBOARD_FORMAT = '3dstreet/entity';
const CLIPBOARD_VERSION = 1;
const HTML_DATA_ATTRIBUTE = 'data-3dstreet-clipboard';

// Random per-page-load token. Paste uses it to tell "the copy source lives in
// this same document" (nudge the pasted copy so it doesn't z-fight its
// source) from a cross-scene paste (preserve the position exactly).
const DOCUMENT_TOKEN = createUniqueId();

// Same-tab fallback for browsers/contexts where async clipboard read or
// write is unavailable or denied.
let memoryClipboard = null;

// Offset applied on x when pasting a street/entity whose source is still
// present in this document, so the copy is visibly separate.
const SAME_SCENE_PASTE_OFFSET = 5;

function classifyEntity(entity) {
  if (entity.hasAttribute('managed-street')) return 'street';
  if (entity.hasAttribute('street-segment')) return 'segment';
  return 'entity';
}

/* ---------- envelope encoding ---------- */

// Unicode-safe base64 helpers. Chunked to avoid call-stack limits on large
// streets (String.fromCharCode.apply with huge arrays overflows).
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseEnvelope(json) {
  try {
    const parsed = JSON.parse(json);
    if (parsed && parsed.format === CLIPBOARD_FORMAT && parsed.data) {
      return parsed;
    }
  } catch (e) {
    // not JSON / not ours
  }
  return null;
}

function extractEnvelopeFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const el = doc.querySelector(`[${HTML_DATA_ATTRIBUTE}]`);
  if (!el) return null;
  try {
    return parseEnvelope(decodeBase64(el.getAttribute(HTML_DATA_ATTRIBUTE)));
  } catch (e) {
    return null;
  }
}

/* ---------- system clipboard I/O ---------- */

async function writeToSystemClipboard(envelope) {
  const json = JSON.stringify(envelope);
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      const html = `<span ${HTML_DATA_ATTRIBUTE}="${encodeBase64(json)}"></span>`;
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([json], { type: 'text/plain' })
        })
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      return true;
    }
  } catch (err) {
    console.warn('[clipboard] system clipboard write unavailable:', err);
  }
  return false;
}

/**
 * @returns {{ok: boolean, envelope: object|null}} ok=false means the system
 * clipboard could not be read at all (fall back to the in-memory copy);
 * ok=true with envelope=null means it was read fine but holds something that
 * isn't ours (do NOT fall back — the user copied something else since).
 */
async function readFromSystemClipboard() {
  try {
    if (navigator.clipboard?.read && window.ClipboardItem) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text();
          const envelope = extractEnvelopeFromHtml(html);
          if (envelope) return { ok: true, envelope };
        }
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text();
          const envelope = parseEnvelope(text);
          if (envelope) return { ok: true, envelope };
        }
      }
      return { ok: true, envelope: null };
    }
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      return { ok: true, envelope: parseEnvelope(text) };
    }
  } catch (err) {
    console.warn('[clipboard] system clipboard read unavailable:', err);
  }
  return { ok: false, envelope: null };
}

/* ---------- copy / cut ---------- */

/**
 * Copy the currently selected entity to the clipboard.
 * Not undoable (does not modify the scene).
 * @returns {Promise<boolean>} true if something was copied
 */
export async function copySelectedEntity() {
  const entity = AFRAME.INSPECTOR.selectedEntity;
  if (!entity) return false;

  const data = STREET.utils.getElementData(entity);
  if (!data) {
    STREET.notify.warningMessage('This entity cannot be copied.');
    return false;
  }

  const envelope = {
    format: CLIPBOARD_FORMAT,
    version: CLIPBOARD_VERSION,
    kind: classifyEntity(entity),
    documentToken: DOCUMENT_TOKEN,
    sourceEntityId: entity.id || null,
    data
  };

  memoryClipboard = envelope;
  await writeToSystemClipboard(envelope);
  return true;
}

/**
 * Cut = Copy + undoable delete (no confirmation prompt, since the removal
 * can be undone). The copy portion is not part of undo history.
 * @returns {Promise<boolean>} true if the entity was cut
 */
export async function cutSelectedEntity() {
  const entity = AFRAME.INSPECTOR.selectedEntity;
  if (!entity) return false;

  const copied = await copySelectedEntity();
  if (!copied) return false;

  AFRAME.INSPECTOR.execute('entityremove', entity);
  return true;
}

/* ---------- paste ---------- */

function setComponentProperty(entityData, componentName, property, value) {
  const styleParser = AFRAME.utils.styleParser;
  const current = entityData.components?.[componentName];
  const parsed =
    typeof current === 'string' ? styleParser.parse(current) : current || {};
  parsed[property] = value;
  entityData.components = entityData.components || {};
  entityData.components[componentName] = styleParser.stringify(parsed);
}

/**
 * Resolve which managed street a segment should paste into, and at what
 * child index. Priority: after the selected segment → into the selected (or
 * containing) street → into the scene's first street.
 */
function resolveSegmentTarget() {
  const selected = AFRAME.INSPECTOR.selectedEntity;

  if (selected?.hasAttribute('street-segment')) {
    const streetEl = selected.closest('[managed-street]');
    if (streetEl && selected.parentNode === streetEl) {
      return {
        streetEl,
        index: Array.from(streetEl.children).indexOf(selected) + 1
      };
    }
  }

  const containingStreet = selected?.closest('[managed-street]');
  if (containingStreet) {
    return { streetEl: containingStreet, index: undefined };
  }

  const firstStreet = document.querySelector(
    '#street-container [managed-street]'
  );
  if (firstStreet) {
    return { streetEl: firstStreet, index: undefined };
  }

  return null;
}

function pasteSegment(envelope) {
  const target = resolveSegmentTarget();
  if (!target) {
    STREET.notify.warningMessage('Select a street to paste this segment into.');
    return false;
  }

  const { streetEl, index } = target;
  if (!streetEl.id) {
    streetEl.id = createUniqueId();
  }

  const entityData = JSON.parse(JSON.stringify(envelope.data));

  // Match the pasted segment's length to the target street; street-align
  // takes care of x-positioning on the segments-changed mutation.
  const streetLength = streetEl.getAttribute('managed-street')?.length;
  if (typeof streetLength === 'number') {
    setComponentProperty(entityData, 'street-segment', 'length', streetLength);
  }

  AFRAME.INSPECTOR.execute('entitypaste', {
    entityData,
    parentId: streetEl.id,
    index,
    name: 'Paste Segment'
  });
  return true;
}

function pasteStreetOrEntity(envelope) {
  const parentEl = document.querySelector(
    AFRAME.INSPECTOR.config.defaultParent
  );
  if (!parentEl) {
    console.error('[clipboard] default parent not found, cannot paste');
    return false;
  }
  if (!parentEl.id) {
    parentEl.id = createUniqueId();
  }

  const entityData = JSON.parse(JSON.stringify(envelope.data));

  // Same-document paste while the source still exists: nudge the copy so it
  // doesn't sit exactly on top of the original. Cross-scene pastes keep the
  // source position so known-good designs land where they were built.
  if (
    envelope.documentToken === DOCUMENT_TOKEN &&
    envelope.sourceEntityId &&
    document.getElementById(envelope.sourceEntityId)
  ) {
    const positionStr = entityData.components?.position || '0 0 0';
    const position = AFRAME.utils.coordinates.parse(positionStr);
    position.x += SAME_SCENE_PASTE_OFFSET;
    entityData.components = entityData.components || {};
    entityData.components.position =
      AFRAME.utils.coordinates.stringify(position);
  }

  AFRAME.INSPECTOR.execute('entitypaste', {
    entityData,
    parentId: parentEl.id,
    name: envelope.kind === 'street' ? 'Paste Street' : 'Paste'
  });
  return true;
}

/**
 * Paste from the system clipboard (falling back to the in-memory copy when
 * clipboard read is unavailable). Pasting is undoable; reading is not a
 * scene mutation and never enters history.
 * @returns {Promise<boolean>} true if something was pasted
 */
export async function pasteFromClipboard() {
  const result = await readFromSystemClipboard();
  const envelope = result.ok ? result.envelope : memoryClipboard;

  if (!envelope) {
    STREET.notify.warningMessage('Nothing to paste from the clipboard.');
    return false;
  }

  if (envelope.kind === 'segment') {
    return pasteSegment(envelope);
  }
  return pasteStreetOrEntity(envelope);
}
