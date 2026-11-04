// The undo-list labels for the easy gizmo's three gesture kinds.
//
// `Inspector.execute` takes a DISPLAY NAME, which History assigns straight to
// the command, so what is passed has to be resolved text and never a message
// id — passing the id would put `actionBar.easyTool.move` in the undo list.
//
// Declared with defineMessages so the formatjs extraction picks them up (it
// scans the source for descriptors, and these strings have no JSX to be found
// in), and resolved framework-free because the commit path is a plain module
// with no react-intl provider above it. Same approach as the shared strings in
// @shared/i18n.

import { defineMessages } from 'react-intl';
import { MESSAGES } from '../../i18n/messages.js';
import { getActiveLocale } from '@shared/utils/format';

export const easyGizmoMessages = defineMessages({
  move: {
    id: 'actionBar.easyTool.move',
    defaultMessage: 'Move'
  },
  rotate: {
    id: 'actionBar.easyTool.rotate',
    defaultMessage: 'Rotate'
  },
  place: {
    id: 'actionBar.easyTool.place',
    defaultMessage: 'Place'
  }
});

export function easyGizmoCommandName(kind) {
  const descriptor = easyGizmoMessages[kind];
  if (!descriptor) return undefined;
  const locale = getActiveLocale();
  const catalog = MESSAGES[locale] || MESSAGES.en;
  return catalog[descriptor.id] || descriptor.defaultMessage;
}
