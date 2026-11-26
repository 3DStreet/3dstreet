/**
 * What the app hosting the Settings panel provides (the editor or the
 * generator): Settings is shared and never reaches into an app's store or
 * notification system directly.
 *
 *   notify(message, type)   show a toast; type 'success' | 'error' | 'info'
 *   confirm(options)        resolves true/false; options = { title, message,
 *                           confirmLabel, destructive } (SettingsModal
 *                           provides it with the shared ConfirmModal)
 *   onUpgrade(source)       open the app's upgrade / checkout flow
 *   onOpenInvitation(id)    show an invitation (InvitationModal)
 *   close()                 close the Settings panel
 */
import { createContext, useContext } from 'react';

export const SettingsHostContext = createContext({
  notify: () => {},
  confirm: async () => false,
  onUpgrade: () => {},
  onOpenInvitation: () => {},
  close: () => {}
});

export const useSettingsHost = () => useContext(SettingsHostContext);
