// User-facing sentences raised by the shape draw tool, which runs outside any
// react-intl provider's reach (a hook driving canvas listeners). Declared with
// defineMessages so the formatjs extraction finds them, and resolved against
// the active locale's catalog, as groups/groupMessages.js does. No
// placeholders.

import { defineMessages } from 'react-intl';
import { MESSAGES } from '../i18n/messages.js';
import { getActiveLocale } from '@shared/utils/format';

export const shapeDrawMessages = defineMessages({
  // Snap refuses the close, and the close would be accepted with snap off.
  snapCloseRefused: {
    id: 'shapeDraw.snapCloseRefused',
    defaultMessage:
      "This shape can't close on the current angle snap. Add another point, press Enter to finish it open, or turn snap off."
  },
  // Snap refuses the close, and turning snap off would not help either.
  closeRefused: {
    id: 'shapeDraw.closeRefused',
    defaultMessage:
      "This shape can't close here. Add another point, or press Enter to finish it open."
  }
});

export function shapeDrawMessage(key) {
  const descriptor = shapeDrawMessages[key];
  if (!descriptor) return undefined;
  const catalog = MESSAGES[getActiveLocale()] || MESSAGES.en;
  return catalog[descriptor.id] || descriptor.defaultMessage;
}
