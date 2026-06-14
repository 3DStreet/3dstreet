import { useContext } from 'react';
import { Tooltip } from 'radix-ui';
import posthog from 'posthog-js';
import { faLockOpen } from '@fortawesome/free-solid-svg-icons';
import { ProfileButton } from '@shared/auth/components';
import useStore from '@/store';
import { AuthContext } from '@/editor/contexts';
import ComponentsSidebar from '../elements/Sidebar';
import { Button, Tabs } from '../elements';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import AIChatPanel from './AIChatPanel';
import ShinyPanel from './ShinyPanel';
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
  const { currentUser: authUser, isLoading } = useContext(AuthContext) || {};
  const setModal = useStore((s) => s.setModal);
  const activeTab = useStore((s) => s.rightPanelTab);
  const setActiveTab = useStore((s) => s.setRightPanelTab);
  const panelsVisible = useStore((s) => s.panelsVisible);

  const planLabel = authUser?.isPro
    ? authUser?.isProTeam
      ? 'PRO TEAM'
      : 'PRO'
    : 'FREE';
  const planTooltip = authUser?.isPro
    ? authUser?.isProTeam
      ? `3DStreet Team Plan (${authUser?.teamDomain})`
      : '3DStreet Pro Plan'
    : '3DStreet Free Community Edition';

  const handleShare = () => {
    if (authUser && window.STREET?.utils?.getAuthorId?.() === authUser.uid) {
      useStore.getState().saveScene(false);
    }
    useStore.getState().setModal('share');
  };

  const openPropertiesTab = () => setActiveTab('properties');
  const openConsoleTab = () => setActiveTab('console');
  const openShinyTab = () => setActiveTab('shiny');

  return (
    <Tooltip.Provider>
      <div
        id="rightPanel"
        className={styles.rightPanel}
        style={{ display: panelsVisible ? 'flex' : 'none' }}
      >
        <div className={styles.header}>
          <div className={styles.headerRow}>
            <TooltipWrapper content="Share scene">
              <Button
                leadingIcon={<AwesomeIcon icon={faLockOpen} size={18} />}
                onClick={handleShare}
                variant="toolbtn"
              >
                <div>Share</div>
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
                label: 'Properties',
                value: 'properties',
                isSelected: activeTab === 'properties',
                onClick: openPropertiesTab
              },
              {
                label: 'Console',
                value: 'console',
                isSelected: activeTab === 'console',
                onClick: openConsoleTab
              },
              {
                label: 'Shiny',
                value: 'shiny',
                isSelected: activeTab === 'shiny',
                onClick: openShinyTab
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
          <div
            className={`${styles.tabPane} ${styles.tabPaneFlex}`}
            style={{ display: activeTab === 'shiny' ? 'flex' : 'none' }}
          >
            <ShinyPanel />
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
