import { useContext } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { Tooltip } from 'radix-ui';
import posthog from 'posthog-js';
import { faLockOpen } from '@fortawesome/free-solid-svg-icons';
import { ProfileButton } from '@shared/auth/components';
import useStore from '@/store';
import { AuthContext } from '@/editor/contexts';
import { commonMessages } from '@/editor/i18n/commonMessages';
import ComponentsSidebar from '../elements/Sidebar';
import { Button, Tabs } from '../elements';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import AIChatPanel from './AIChatPanel';
import styles from './RightPanel.module.scss';

const TooltipWrapper = ({ children, content, side = 'bottom' }) => (
  <Tooltip.Root delayDuration={0}>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side={side}
        sideOffset={5}
        style={{
          backgroundColor: '#2d2d2d',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '12px',
          border: '1px solid #4b4b4b',
          zIndex: 1000
        }}
      >
        {content}
        <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

export default function RightPanel({ entity }) {
  const intl = useIntl();
  const { currentUser: authUser, isLoading } = useContext(AuthContext) || {};
  const setModal = useStore((s) => s.setModal);
  const activeTab = useStore((s) => s.rightPanelTab);
  const setActiveTab = useStore((s) => s.setRightPanelTab);
  const panelsVisible = useStore((s) => s.panelsVisible);

  // Tier ('MAX' | 'PRO' | null) takes precedence over the team label since
  // there is no Max Team product yet — domain teams are always Pro-level.
  const isMax = authUser?.plan === 'MAX';
  const planLabel = !authUser?.isPro
    ? 'FREE'
    : isMax
      ? 'MAX'
      : authUser?.isProTeam
        ? 'PRO TEAM'
        : 'PRO';
  const planTooltip = !authUser?.isPro
    ? intl.formatMessage({
        id: 'rightPanel.planTooltipFree',
        defaultMessage: '3DStreet Free Community Edition'
      })
    : isMax
      ? intl.formatMessage({
          id: 'rightPanel.planTooltipMax',
          defaultMessage: '3DStreet Max Plan'
        })
      : authUser?.isProTeam
        ? intl.formatMessage(
            {
              id: 'rightPanel.planTooltipTeam',
              defaultMessage: '3DStreet Team Plan ({teamDomain})'
            },
            { teamDomain: authUser?.teamDomain }
          )
        : intl.formatMessage({
            id: 'rightPanel.planTooltipPro',
            defaultMessage: '3DStreet Pro Plan'
          });

  const handleShare = () => {
    if (authUser && window.STREET?.utils?.getAuthorId?.() === authUser.uid) {
      useStore.getState().saveScene(false);
    }
    useStore.getState().setModal('share');
  };

  const openPropertiesTab = () => setActiveTab('properties');
  const openConsoleTab = () => setActiveTab('console');

  return (
    <Tooltip.Provider>
      <div
        id="rightPanel"
        className={styles.rightPanel}
        style={{ display: panelsVisible ? 'flex' : 'none' }}
      >
        <div className={styles.header}>
          <div className={styles.headerRow}>
            <TooltipWrapper
              content={
                <FormattedMessage
                  id="rightPanel.shareScene"
                  defaultMessage="Share scene"
                />
              }
            >
              <Button
                leadingIcon={<AwesomeIcon icon={faLockOpen} size={18} />}
                onClick={handleShare}
                variant="toolbtn"
              >
                <div>
                  <FormattedMessage {...commonMessages.share} />
                </div>
              </Button>
            </TooltipWrapper>
            <div className={styles.headerSpacer} />
            <TooltipWrapper content={planTooltip}>
              <div
                className={styles.planBadge}
                onClick={() => setModal(authUser ? 'profile' : 'signin')}
              >
                {planLabel}
              </div>
            </TooltipWrapper>
            <ProfileButton
              currentUser={authUser}
              isLoading={isLoading}
              onClick={() => {
                if (isLoading) return;
                posthog.capture('profile_button_clicked', {
                  is_logged_in: !!authUser
                });
                setModal(authUser ? 'profile' : 'signin');
              }}
              tooltipSide="bottom"
            />
          </div>
        </div>
        <div className={styles.tabsRow}>
          <Tabs
            tabs={[
              {
                label: intl.formatMessage({
                  id: 'rightPanel.tabProperties',
                  defaultMessage: 'Properties'
                }),
                value: 'properties',
                isSelected: activeTab === 'properties',
                onClick: openPropertiesTab
              },
              {
                label: intl.formatMessage({
                  id: 'rightPanel.tabConsole',
                  defaultMessage: 'Console'
                }),
                value: 'console',
                isSelected: activeTab === 'console',
                onClick: openConsoleTab
              }
            ]}
          />
        </div>
        <div className={styles.content}>
          <div
            className={`${styles.tabPane} ${styles.tabPaneScroll}`}
            style={{ display: activeTab === 'properties' ? 'block' : 'none' }}
          >
            <ComponentsSidebar entity={entity} />
          </div>
          <div
            className={`${styles.tabPane} ${styles.tabPaneFlex}`}
            style={{ display: activeTab === 'console' ? 'flex' : 'none' }}
          >
            <AIChatPanel />
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
