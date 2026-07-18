import { defineMessages } from 'react-intl';

/**
 * Shared message catalog for strings that appear in more than one place
 * (common buttons, labels, tooltips). Defining them once means they are
 * extracted and translated a single time and stay consistent across the UI.
 *
 * Only put strings here whose meaning is unambiguous in every context they are
 * used (e.g. "Cancel", "Delete"). Context-sensitive words that could translate
 * differently depending on where they appear should keep per-component ids.
 *
 * Usage:
 *   import { commonMessages } from '@/editor/i18n/commonMessages';
 *   <FormattedMessage {...commonMessages.cancel} />
 *   intl.formatMessage(commonMessages.cancel)
 */
export const commonMessages = defineMessages({
  cancel: { id: 'common.cancel', defaultMessage: 'Cancel' },
  retry: { id: 'common.retry', defaultMessage: 'Retry' },
  delete: { id: 'common.delete', defaultMessage: 'Delete' },
  duplicate: { id: 'common.duplicate', defaultMessage: 'Duplicate' },
  focus: { id: 'common.focus', defaultMessage: 'Focus' },
  rename: { id: 'common.rename', defaultMessage: 'Rename' },
  surface: { id: 'common.surface', defaultMessage: 'Surface' },
  share: { id: 'common.share', defaultMessage: 'Share' },
  discord: { id: 'common.discord', defaultMessage: 'Discord' },
  heightLabel: { id: 'common.heightLabel', defaultMessage: 'Height:' },
  widthLabel: { id: 'common.widthLabel', defaultMessage: 'Width:' },
  documentation: {
    id: 'common.documentation',
    defaultMessage: 'Documentation'
  },
  keyboardShortcuts: {
    id: 'common.keyboardShortcuts',
    defaultMessage: 'Keyboard Shortcuts'
  },
  resetCameraView: {
    id: 'common.resetCameraView',
    defaultMessage: 'Reset Camera View'
  },
  // Shared by the View menu's Plan View item and the compass body tooltip —
  // the two are twins (same pose tests, same click action), so they must
  // always read identically.
  planView: { id: 'common.planView', defaultMessage: 'Plan View' },
  pointNorth: { id: 'common.pointNorth', defaultMessage: 'Point North' },
  upgradeToPro: {
    id: 'common.upgradeToPro',
    defaultMessage: 'Upgrade to Pro'
  },
  addLayer: { id: 'common.addLayer', defaultMessage: 'Add layer' },
  signInToCloud: {
    id: 'common.signInToCloud',
    defaultMessage: 'Sign in to 3DStreet Cloud'
  },
  useGeoTokensTooltip: {
    id: 'common.useGeoTokensTooltip',
    defaultMessage:
      'Use geo tokens to set or change a geolocation for your scene.'
  }
});
