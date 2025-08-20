import { useState, useEffect } from 'react';
import styles from './ShareModal.module.scss';
import { useAuthContext } from '../../../contexts';
import { Copy32Icon } from '../../../icons';
import { Button } from '../../elements';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import ScenePlaceholder from '../../../../../ui_assets/ScenePlaceholder.svg';
import { getUserProfile } from '../../../utils/username';
import { Tooltip } from 'radix-ui';

const TooltipWrapper = ({ children, content, side = 'bottom', ...props }) => {
  return (
    <Tooltip.Root delayDuration={0}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={5}
          style={{
            backgroundColor: '#1f2937',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            border: '1px solid #374151',
            zIndex: 1000,
            maxWidth: '200px'
          }}
          {...props}
        >
          {content}
          <Tooltip.Arrow style={{ fill: '#1f2937' }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

function ShareModal() {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const { currentUser } = useAuthContext();

  const [sceneData, setSceneData] = useState(null);
  const [authorUsername, setAuthorUsername] = useState(null);
  const [locationString, setLocationString] = useState(null);

  // Get current scene data
  useEffect(() => {
    const fetchSceneData = async () => {
      const sceneId = STREET.utils.getCurrentSceneId();
      if (!sceneId || !currentUser) {
        setSceneData(null);
        return;
      }

      try {
        const sceneDocRef = doc(db, 'scenes', sceneId);
        const sceneSnapshot = await getDoc(sceneDocRef);
        if (sceneSnapshot.exists()) {
          const data = sceneSnapshot.data();
          setSceneData(data);

          // Fetch author username
          if (data.author) {
            try {
              const profile = await getUserProfile(data.author);
              setAuthorUsername(profile?.username || null);
            } catch (error) {
              console.error('Error fetching author profile:', error);
              setAuthorUsername(null);
            }
          }
        } else {
          setSceneData(null);
          setAuthorUsername(null);
        }
      } catch (error) {
        console.error('Error fetching scene data:', error);
        setSceneData(null);
        setAuthorUsername(null);
      }
    };

    if (modal === 'share') {
      fetchSceneData();

      // Get location string from street-geo component
      const geoLayer = document.getElementById('reference-layers');
      if (geoLayer && geoLayer.hasAttribute('street-geo')) {
        const geoData = geoLayer.getAttribute('street-geo');
        if (geoData.locationString) {
          setLocationString(geoData.locationString);
        }
      } else {
        setLocationString(null);
      }
    }
  }, [modal, currentUser]);

  // Track when share modal opens for camera positioning
  useEffect(() => {
    if (modal === 'share') {
      posthog.capture('share_modal_opened', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
    }
  }, [modal]);

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      STREET.notify.successMessage('Scene URL copied to clipboard');
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const getShareUrl = () => {
    const sceneId = STREET.utils.getCurrentSceneId();
    if (sceneId) {
      return `https://3dstreet.app/#/scenes/${sceneId}`;
    }
    return window.location.href;
  };

  const handleEmailShare = () => {
    const sceneTitle = sceneData?.title || 'Untitled Scene';
    const authorName = authorUsername || 'anonymous';
    const location = locationString || 'Location not set';

    const subject = encodeURIComponent(`Check out "${sceneTitle}" on 3DStreet`);
    const body = encodeURIComponent(
      `I wanted to share this 3DStreet scene with you:\n\n` +
        `Title: ${sceneTitle}\n` +
        `Created by: @${authorName}\n` +
        `Location: ${location}\n\n` +
        `View scene: ${shareUrl}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
    posthog.capture('share_via_email', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
  };

  const handleOSShare = async () => {
    if (navigator.share) {
      try {
        const sceneTitle = sceneData?.title || 'Untitled Scene';
        const authorName = authorUsername || 'anonymous';

        await navigator.share({
          title: `${sceneTitle} - 3DStreet Scene`,
          text: `Check out "${sceneTitle}" by @${authorName} on 3DStreet`,
          url: shareUrl
        });
        posthog.capture('share_via_os', {
          scene_id: STREET.utils.getCurrentSceneId()
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error sharing:', error);
        }
      }
    } else {
      STREET.notify.errorMessage(
        'Web Share API is not supported in this browser'
      );
    }
  };

  const handleDiscordShare = () => {
    const sceneTitle = sceneData?.title || 'Untitled Scene';
    const authorName = authorUsername || 'anonymous';
    const location = locationString || 'Location not set';

    const discordMessage = encodeURIComponent(
      `🏙️ Check out "${sceneTitle}" by @${authorName} on 3DStreet!\n` +
        `📍 ${location}\n` +
        `🔗 ${shareUrl}`
    );
    window.open(
      `https://discord.com/channels/@me?message=${discordMessage}`,
      '_blank'
    );
    posthog.capture('share_via_discord', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
  };

  const sceneId = STREET.utils.getCurrentSceneId();
  const shareUrl = getShareUrl();
  const canShare = currentUser && sceneId;

  return (
    <Tooltip.Provider>
      <Modal
        className={styles.shareModalWrapper}
        isOpen={modal === 'share'}
        onClose={() => setModal(null)}
        titleElement={
          <div className="flex pr-4 pt-4">
            <div className="font-large text-center text-2xl">Share Scene</div>
          </div>
        }
      >
        <div className={styles.wrapper}>
          {!canShare ? (
            <div className={styles.notShareable}>
              <h3>
                {!currentUser
                  ? 'Please sign in to share your scene'
                  : 'Please save your scene to share it'}
              </h3>
              <Button
                onClick={() => {
                  if (!currentUser) {
                    setModal('signin');
                  } else {
                    // User is authenticated but scene isn't saved - trigger save
                    document.getElementById('saveButton')?.click();
                    setModal(null); // Close share modal after triggering save
                  }
                }}
              >
                {!currentUser ? 'Sign in to 3DStreet Cloud' : 'Save Scene'}
              </Button>
            </div>
          ) : (
            <div className={styles.shareableContent}>
              {/* Top row - Image and Scene details */}
              <div className={styles.topRow}>
                {/* Left side - Image */}
                <div className={styles.leftColumn}>
                  <div className={styles.imageWrapper}>
                    <div className={styles.screenshotWrapper}>
                      {sceneData?.imagePath ? (
                        <img src={sceneData.imagePath} alt="Scene preview" />
                      ) : (
                        <img src={ScenePlaceholder} alt="Scene placeholder" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Right side - Scene details */}
                <div className={styles.rightColumn}>
                  <div className={styles.sceneDetails}>
                    <h2 className={styles.sceneTitle}>
                      {sceneData?.title || 'Untitled Scene'}
                    </h2>

                    <div
                      className={`${styles.locationInfo} ${!locationString ? styles.placeholder : ''}`}
                    >
                      {locationString || 'Location not set'}
                    </div>

                    <div
                      className={`${styles.authorInfo} ${!authorUsername ? styles.placeholder : ''}`}
                      onClick={() =>
                        authorUsername ? setModal('profile') : null
                      }
                      style={{ cursor: authorUsername ? 'pointer' : 'default' }}
                    >
                      @{authorUsername || 'anonymous'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Share buttons section */}
              <div className={styles.shareButtonsSection}>
                <TooltipWrapper
                  content="Share scene as a new email draft"
                  side="top"
                >
                  <Button
                    onClick={handleEmailShare}
                    variant="toolbtn"
                    className={styles.shareButton}
                  >
                    ✉️ Email
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper
                  content="Use your browser's share feature to send your scene to others"
                  side="top"
                >
                  <Button
                    onClick={handleOSShare}
                    variant="toolbtn"
                    className={styles.shareButton}
                  >
                    📤 Share
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper
                  content="Post this scene to the 3DStreet Discord server to share with other creators"
                  side="top"
                >
                  <Button
                    onClick={handleDiscordShare}
                    variant="toolbtn"
                    className={styles.shareButton}
                  >
                    💬 Discord
                  </Button>
                </TooltipWrapper>
              </div>

              {/* Share URL section */}
              <div className={styles.shareUrlSection}>
                <div className={styles.urlInputWrapper}>
                  <textarea
                    readOnly
                    value={shareUrl}
                    className={styles.urlTextarea}
                    rows={2}
                  />
                  <Button
                    onClick={() => copyToClipboard(shareUrl)}
                    leadingIcon={<Copy32Icon />}
                    variant="toolbtn"
                    className={styles.copyButton}
                  >
                    Copy URL
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </Tooltip.Provider>
  );
}

export { ShareModal };
