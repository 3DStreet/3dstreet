/**
 * Framework-free confirm dialog shown before a language switch that reloads the
 * page (the generator rebuilds its vanilla DOM in the new locale, which discards
 * an in-progress prompt and uploaded source assets). Asks the user to confirm
 * the reload, showing the prompt in BOTH the current and the requested language.
 *
 * Vanilla DOM (not a React component) on purpose: the shared LanguageSelector
 * renders inside a Radix Popover that unmounts its content on outside-click, so
 * a React-owned modal would be torn down the moment it takes focus. A dialog
 * appended to document.body survives that. It is also NOT a native
 * confirm()/alert() — those block the browser-extension automation channel.
 *
 * Returns a Promise<boolean>: true = reload/switch, false = cancel.
 */
import { formatSharedMessage } from './sharedMessages';
import { SUPPORTED_LOCALES } from './locales';

function endonym(code) {
  return SUPPORTED_LOCALES.find((l) => l.code === code)?.label ?? code;
}

export function confirmLocaleReload({ fromLocale, toLocale }) {
  return new Promise((resolve) => {
    // Non-DOM environments (tests) — nothing to confirm against, proceed.
    if (typeof document === 'undefined' || !document.body) {
      resolve(true);
      return;
    }

    const values = { from: endonym(fromLocale), to: endonym(toLocale) };
    const msgCurrent = formatSharedMessage('reloadLanguageConfirm', values, {
      locale: fromLocale
    });
    const msgRequested = formatSharedMessage('reloadLanguageConfirm', values, {
      locale: toLocale
    });
    // Cancel keeps the current language; Reload takes you to the requested one —
    // so each button is labeled in the language it lands you in.
    const cancelLabel = formatSharedMessage('cancel', null, {
      locale: fromLocale
    });
    const reloadLabel = formatSharedMessage('reload', null, {
      locale: toLocale
    });

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.5)',
      padding: '16px',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
    });

    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    Object.assign(card.style, {
      background: '#ffffff',
      color: '#1a1a1a',
      borderRadius: '12px',
      boxShadow: '0 10px 38px -10px rgba(0, 0, 0, 0.5)',
      maxWidth: '360px',
      width: '100%',
      padding: '20px',
      boxSizing: 'border-box'
    });

    const makeLine = (text, muted) => {
      const p = document.createElement('p');
      p.textContent = text;
      Object.assign(p.style, {
        margin: '0 0 8px',
        fontSize: '14px',
        lineHeight: '1.4',
        color: muted ? '#6b7280' : '#1a1a1a'
      });
      return p;
    };
    card.appendChild(makeLine(msgCurrent, false));
    card.appendChild(makeLine(msgRequested, true));

    const buttons = document.createElement('div');
    Object.assign(buttons.style, {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
      marginTop: '16px'
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelLabel;
    Object.assign(cancelBtn.style, {
      padding: '8px 14px',
      borderRadius: '8px',
      border: '1px solid #d1d5db',
      background: '#ffffff',
      color: '#1a1a1a',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer'
    });

    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.textContent = reloadLabel;
    Object.assign(reloadBtn.style, {
      padding: '8px 14px',
      borderRadius: '8px',
      border: 'none',
      background: '#6d51e5',
      color: '#ffffff',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer'
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(reloadBtn);
    card.appendChild(buttons);
    overlay.appendChild(card);

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };

    cancelBtn.addEventListener('click', () => close(false));
    reloadBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    reloadBtn.focus();
  });
}

export default confirmLocaleReload;
