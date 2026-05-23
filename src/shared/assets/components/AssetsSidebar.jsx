/**
 * AssetsSidebar - Collapsible sidebar wrapper used by the generator app
 * (and bollardbuddy). Hosts the shared AssetsPanelBody (filters / upload /
 * usage meter / grid) — visual parity with the editor's Assets panel.
 */

import { useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import AssetsPanelBody from './AssetsPanelBody.jsx';
import styles from './Assets.module.scss';

const AssetsSidebar = ({
  onCopyParams,
  onUseForGenerator,
  onUseForVideo,
  onNotification,
  onSignIn
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <>
      {/* Toggle Button */}
      <Tooltip.Provider>
        <Tooltip.Root delayDuration={0}>
          <Tooltip.Trigger asChild>
            <button
              id="assets-toggle"
              className={styles.toggle}
              onClick={() => setIsCollapsed((c) => !c)}
              aria-label="Toggle Assets"
            >
              {isCollapsed ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 31 31"
                  stroke="currentColor"
                >
                  <path
                    d="M2.16666 23.6667L8.09024 17.7431C8.57469 17.2588 9.23165 16.9867 9.91666 16.9867C10.6017 16.9867 11.2586 17.2588 11.7431 17.7431L17.6667 23.6667M15.0833 21.0834L17.1319 19.0348C17.6164 18.5505 18.2733 18.2784 18.9583 18.2784C19.6433 18.2784 20.3003 18.5505 20.7847 19.0348L22.8333 21.0834M15.0833 13.3334H15.0962M4.74999 28.8334H20.25C20.9351 28.8334 21.5922 28.5612 22.0767 28.0767C22.5612 27.5922 22.8333 26.9352 22.8333 26.25V10.75C22.8333 10.0649 22.5612 9.4078 22.0767 8.92333C21.5922 8.43886 20.9351 8.16669 20.25 8.16669H4.74999C4.06485 8.16669 3.40777 8.43886 2.9233 8.92333C2.43883 9.4078 2.16666 10.0649 2.16666 10.75V26.25C2.16666 26.9352 2.43883 27.5922 2.9233 28.0767C3.40777 28.5612 4.06485 28.8334 4.74999 28.8334Z"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M23.5833 25.6667C24.2685 25.6667 24.9256 25.3945 25.41 24.91C25.8945 24.4256 26.1667 23.7685 26.1667 23.0833V7.58333C26.1667 6.89819 25.8945 6.24111 25.41 5.75664C24.9256 5.27217 24.2685 5 23.5833 5H8.08333C7.39819 5 6.74111 5.27217 6.25664 5.75664C5.77217 6.24111 5.5 6.89819 5.5 7.58333"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M26.5833 22.6667C27.2685 22.6667 27.9256 22.3945 28.41 21.91C28.8945 21.4256 29.1667 20.7685 29.1667 20.0833V4.58333C29.1667 3.89819 28.8945 3.24111 28.41 2.75664C27.9256 2.27217 27.2685 2 26.5833 2H11.0833C10.3982 2 9.74111 2.27217 9.25664 2.75664C8.77217 3.24111 8.5 3.89819 8.5 4.58333"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 5l7 7-7 7M5 5l7 7-7 7"
                  />
                </svg>
              )}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="left"
              sideOffset={5}
              style={{
                backgroundColor: '#2d2d2d',
                color: 'white',
                padding: '6px 12px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '500',
                zIndex: 10000,
                maxWidth: '200px'
              }}
            >
              Show Assets
              <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>

      {/* Sidebar */}
      <div
        id="assets-container"
        className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''}`}
      >
        <div className={styles.header}>
          <div className={styles.title}>Assets</div>
        </div>
        <AssetsPanelBody
          onCopyParams={onCopyParams}
          onUseForGenerator={onUseForGenerator}
          onUseForVideo={onUseForVideo}
          onNotification={onNotification}
          onSignIn={onSignIn}
        />
      </div>
    </>
  );
};

export default AssetsSidebar;
