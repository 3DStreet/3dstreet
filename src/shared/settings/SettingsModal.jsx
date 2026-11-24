/* global VERSION */
/**
 * Settings (Kieran's review, docs/settings.md), opened from the profile
 * menu: the sections are listed on the left (tabs on a phone):
 *   Profile                        the account, the public @username,
 *                                  pending team invitations
 *   Usage and billing · Personal   the user's own plan and tokens
 *   Teams, for each team:
 *     Usage and billing · {team}   its plan, storage and AI wallet
 *     Manage {team}                members, roles, invitations, what
 *                                  members can edit
 * Shared by the editor and the generator; each passes what's app-specific
 * (SettingsHost.js).
 *
 * Props:
 *   isOpen, onClose
 *   section          { id: 'profile' | 'billing' | 'team', orgId? } and
 *                    onSectionChange(section)
 *   notify, onUpgrade, onOpenInvitation   see SettingsHost.js
 *   loadMessages     for an app without a react-intl IntlProvider (the
 *                    generator): () => Promise<{ [locale]: messages }>
 */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { IntlContext, IntlProvider, useIntl } from 'react-intl';
import posthog from 'posthog-js';
import Modal from '@shared/components/Modal/Modal.jsx';
import { ConfirmModal } from '@shared/components/ConfirmModal';
import { useAuthContext } from '@shared/contexts';
import { getActiveLocale } from '@shared/utils/format';
import classNames from 'classnames';
import { SettingsHostContext } from './SettingsHost';
import { settingsMessages } from './settingsMessages';
import { AccountSection } from './sections/AccountSection';
import { PublicProfileSection } from './sections/PublicProfileSection';
import { BillingSection } from './sections/BillingSection';
import { InvitationsSection } from './sections/InvitationsSection';
import { TeamSection } from './team/TeamSection';
import styles from './SettingsModal.module.scss';

function SettingsPanel({
  isOpen,
  section,
  onSectionChange,
  onClose,
  notify,
  onUpgrade,
  onOpenInvitation
}) {
  const intl = useIntl();
  const { currentUser } = useAuthContext();
  const [confirmState, setConfirmState] = useState(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => setConfirmState({ ...options, resolve })),
    []
  );
  const settle = (answer) => {
    confirmState?.resolve(answer);
    setConfirmState(null);
  };

  const host = useMemo(
    () => ({ notify, confirm, onUpgrade, onOpenInvitation, close: onClose }),
    [notify, confirm, onUpgrade, onOpenInvitation, onClose]
  );

  const teams = currentUser?.orgs || [];
  // A section of a team the user left (or never had) shows Profile.
  const team = section?.orgId
    ? teams.find((org) => org.orgId === section.orgId)
    : null;
  const current =
    section?.id === 'team' && team
      ? { id: 'team', orgId: team.orgId }
      : section?.id === 'billing'
        ? { id: 'billing', orgId: team ? team.orgId : null }
        : { id: 'profile', orgId: null };

  useEffect(() => {
    if (isOpen) {
      posthog.capture('modal_opened', { modal: `settings_${current.id}` });
    }
  }, [isOpen, current.id]);

  const navItem = (target, label, sub = false) => {
    const selected =
      current.id === target.id && current.orgId === (target.orgId || null);
    return (
      <li key={`${target.id}-${target.orgId || ''}`}>
        <button
          type="button"
          className={classNames(styles.navItem, {
            [styles.navSelected]: selected,
            [styles.navSub]: sub
          })}
          aria-current={selected ? 'page' : undefined}
          onClick={() => onSectionChange(target)}
        >
          {label}
        </button>
      </li>
    );
  };
  const personal = intl.formatMessage(settingsMessages.personal);

  return (
    <SettingsHostContext.Provider value={host}>
      <Modal
        className={styles.modalWrapper}
        isOpen={isOpen}
        onClose={onClose}
        title={intl.formatMessage(settingsMessages.title)}
      >
        <div className={styles.layout}>
          <nav
            className={styles.nav}
            aria-label={intl.formatMessage(settingsMessages.sections)}
          >
            <ul>
              {navItem(
                { id: 'profile' },
                intl.formatMessage(settingsMessages.profile)
              )}
              {navItem(
                { id: 'billing' },
                intl.formatMessage(settingsMessages.billingOf, {
                  name: personal
                })
              )}
              {teams.length > 0 && (
                <li className={styles.navHeading}>
                  {intl.formatMessage(settingsMessages.teams)}
                </li>
              )}
              {teams.flatMap((org) => [
                navItem(
                  { id: 'billing', orgId: org.orgId },
                  intl.formatMessage(settingsMessages.billingOf, {
                    name: org.name
                  }),
                  true
                ),
                navItem(
                  { id: 'team', orgId: org.orgId },
                  intl.formatMessage(settingsMessages.manageTeam, {
                    team: org.name
                  }),
                  true
                )
              ])}
            </ul>
          </nav>
          <section className={styles.content}>
            {current.id === 'profile' && (
              <>
                <AccountSection />
                <PublicProfileSection />
                <InvitationsSection />
                {typeof VERSION !== 'undefined' && (
                  <p className={styles.version}>3DStreet {VERSION}</p>
                )}
              </>
            )}
            {current.id === 'billing' && (
              <BillingSection key={current.orgId} orgId={current.orgId} />
            )}
            {current.id === 'team' && (
              <TeamSection key={current.orgId} orgId={current.orgId} />
            )}
          </section>
        </div>
      </Modal>
      <ConfirmModal
        isOpen={!!confirmState}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={intl.formatMessage(settingsMessages.cancel)}
        destructive={!!confirmState?.destructive}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </SettingsHostContext.Provider>
  );
}

/**
 * Provides react-intl to Settings where the app has none (the generator),
 * with the editor's catalogs loaded on first open.
 */
function SettingsIntl({ loadMessages, children }) {
  const existing = useContext(IntlContext);
  const [catalogs, setCatalogs] = useState(null);
  useEffect(() => {
    if (existing || !loadMessages || catalogs) return;
    loadMessages()
      .then(setCatalogs)
      .catch((error) => console.error('Error loading Settings text:', error));
  }, [existing, loadMessages, catalogs]);
  if (existing) return children;
  if (!catalogs) return null;
  const locale = getActiveLocale();
  return (
    <IntlProvider
      locale={locale}
      defaultLocale="en"
      messages={catalogs[locale] || catalogs.en}
      onError={(error) => {
        if (error.code !== 'MISSING_TRANSLATION') console.error(error);
      }}
    >
      {children}
    </IntlProvider>
  );
}

export function SettingsModal({ loadMessages, ...props }) {
  if (!props.isOpen) return null;
  return (
    <SettingsIntl loadMessages={loadMessages}>
      <SettingsPanel {...props} />
    </SettingsIntl>
  );
}

SettingsModal.propTypes = {
  isOpen: PropTypes.bool,
  section: PropTypes.shape({ id: PropTypes.string, orgId: PropTypes.string }),
  onSectionChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  notify: PropTypes.func.isRequired,
  onUpgrade: PropTypes.func.isRequired,
  onOpenInvitation: PropTypes.func.isRequired,
  loadMessages: PropTypes.func
};
