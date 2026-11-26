/**
 * Strings of Settings that several sections share. Settings is shared code,
 * so it doesn't import the editor's commonMessages; the ids are its own.
 */
import { defineMessages } from 'react-intl';

export const settingsMessages = defineMessages({
  title: { id: 'settings.title', defaultMessage: 'Settings' },
  sections: { id: 'settings.nav.label', defaultMessage: 'Settings sections' },
  profile: { id: 'settings.nav.profile', defaultMessage: 'Profile' },
  billingOf: {
    id: 'settings.nav.billingOf',
    defaultMessage: 'Usage and billing · {name}'
  },
  teams: { id: 'settings.nav.teams', defaultMessage: 'Teams' },
  manageTeam: {
    id: 'settings.nav.manageTeam',
    defaultMessage: 'Manage {team}'
  },
  personal: { id: 'settings.personal', defaultMessage: 'Personal' },
  rename: { id: 'settings.rename', defaultMessage: 'Rename' },
  cancel: { id: 'settings.cancel', defaultMessage: 'Cancel' },
  upgradeToPro: {
    id: 'settings.upgradeToPro',
    defaultMessage: 'Upgrade to Pro'
  }
});
