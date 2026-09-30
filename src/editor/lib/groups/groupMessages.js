// User-facing strings for groups that are raised from plain modules (the
// command guard, placement), where no react-intl provider is in reach.
//
// Declared with defineMessages so the formatjs extraction finds them, and
// resolved framework-free against the active locale's catalog, as
// gizmos/easyGizmoMessages.js does. A `.jsx` caller raising one of these goes
// through groupMessage() too, so one locale shows one language whichever route
// raised the message. The resolver is a plain lookup: messages carry no
// placeholders.

import { defineMessages } from 'react-intl';
import { MESSAGES } from '../../i18n/messages.js';
import { getActiveLocale } from '@shared/utils/format';

export const groupMessages = defineMessages({
  nonUniformScale: {
    id: 'groups.refusal.nonUniformScale',
    defaultMessage:
      'A group can only be scaled by the same amount along every axis.'
  },
  illegalParent: {
    id: 'groups.refusal.illegalParent',
    defaultMessage: 'This item cannot be moved into that layer.'
  },
  unrepresentablePose: {
    id: 'groups.refusal.unrepresentablePose',
    defaultMessage:
      "This item cannot be moved there without distorting it, because the destination group's scale is not the same along every axis."
  },
  destinationGone: {
    id: 'groups.refusal.destinationGone',
    defaultMessage:
      'The group this was being added to is no longer available, so nothing was added.'
  }
});

export function groupMessage(key) {
  const descriptor = groupMessages[key];
  if (!descriptor) return undefined;
  const catalog = MESSAGES[getActiveLocale()] || MESSAGES.en;
  return catalog[descriptor.id] || descriptor.defaultMessage;
}
