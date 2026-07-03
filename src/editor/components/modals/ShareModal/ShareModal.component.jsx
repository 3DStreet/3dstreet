import { useState, useEffect } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import styles from './ShareModal.module.scss';
import { useAuthContext } from '../../../contexts';
import { Copy32Icon } from '@shared/icons';
import { Button } from '../../elements';
import Modal from '@shared/components/Modal/Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '@shared/services/firebase';
import { shareSceneToDiscord } from '../../../api/scene';
import ScenePlaceholder from '../../../../../ui_assets/ScenePlaceholder.svg';
import { getUserProfile } from '@shared/utils/username';
import { Tooltip } from 'radix-ui';
import { commonMessages } from '@/editor/i18n/commonMessages';

const TooltipWrapper = ({ children, content, side = 'bottom', ...props }) => {
  return (
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
            zIndex: 1000,
            maxWidth: '200px'
          }}
          {...props}
        >
          {content}
          <Tooltip.Arrow style={{ fill: '#2d2d2d' }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

function ShareModal() {
  const intl = useIntl();
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
      STREET.notify.successMessage(
        intl.formatMessage({
          id: 'shareModal.urlCopied',
          defaultMessage: 'Scene URL copied to clipboard'
        })
      );
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
    const sceneTitle =
      sceneData?.title ||
      intl.formatMessage({
        id: 'shareModal.untitledScene',
        defaultMessage: 'Untitled Scene'
      });
    const authorName =
      authorUsername ||
      intl.formatMessage({
        id: 'shareModal.anonymous',
        defaultMessage: 'anonymous'
      });
    const location =
      locationString ||
      intl.formatMessage({
        id: 'shareModal.locationNotSet',
        defaultMessage: 'Location not set'
      });

    const subject = encodeURIComponent(
      intl.formatMessage(
        {
          id: 'shareModal.emailSubject',
          defaultMessage: 'Check out "{sceneTitle}" on 3DStreet'
        },
        { sceneTitle }
      )
    );
    const body = encodeURIComponent(
      intl.formatMessage(
        {
          id: 'shareModal.emailBody',
          defaultMessage:
            'I wanted to share this 3DStreet scene with you:\n\nTitle: {sceneTitle}\nCreated by: @{authorName}\nLocation: {location}\n\nView scene: {shareUrl}'
        },
        { sceneTitle, authorName, location, shareUrl }
      )
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
    posthog.capture('share_via_email', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
  };

  const handleOSShare = async () => {
    if (navigator.share) {
      try {
        const sceneTitle =
          sceneData?.title ||
          intl.formatMessage({
            id: 'shareModal.untitledScene',
            defaultMessage: 'Untitled Scene'
          });
        const authorName =
          authorUsername ||
          intl.formatMessage({
            id: 'shareModal.anonymous',
            defaultMessage: 'anonymous'
          });

        await navigator.share({
          title: intl.formatMessage(
            {
              id: 'shareModal.osShareTitle',
              defaultMessage: '{sceneTitle} - 3DStreet Scene'
            },
            { sceneTitle }
          ),
          text: intl.formatMessage(
            {
              id: 'shareModal.osShareText',
              defaultMessage:
                'Check out "{sceneTitle}" by @{authorName} on 3DStreet'
            },
            { sceneTitle, authorName }
          ),
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
        intl.formatMessage({
          id: 'shareModal.webShareUnsupported',
          defaultMessage: 'Web Share API is not supported in this browser'
        })
      );
    }
  };

  const handleDiscordShare = async () => {
    const sceneTitle =
      sceneData?.title ||
      intl.formatMessage({
        id: 'shareModal.untitledScene',
        defaultMessage: 'Untitled Scene'
      });
    const authorName =
      authorUsername ||
      intl.formatMessage({
        id: 'shareModal.anonymous',
        defaultMessage: 'anonymous'
      });
    const location = locationString || '';
    const sceneId = STREET.utils.getCurrentSceneId();
    const imageUrl = sceneData?.imagePath || null;

    try {
      const result = await shareSceneToDiscord({
        title: sceneTitle,
        location: location,
        username: authorName,
        sceneUrl: shareUrl,
        imageUrl: imageUrl
      });

      STREET.notify.successMessage(
        result.message ||
          intl.formatMessage({
            id: 'shareModal.discordSuccess',
            defaultMessage: 'Scene shared to Discord successfully!'
          })
      );

      posthog.capture('share_via_discord_server', {
        scene_id: sceneId,
        success: true
      });
    } catch (error) {
      console.error('Discord share error:', error);
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'shareModal.discordError',
          defaultMessage: 'Failed to share scene to Discord. Please try again.'
        })
      );

      posthog.capture('share_via_discord_server', {
        scene_id: sceneId,
        success: false,
        error: error.message
      });
    }
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
          <div className="flex pr-4 pt-5">
            <div className="font-large text-center text-2xl">
              <FormattedMessage
                id="shareModal.title"
                defaultMessage="Share Scene"
              />
            </div>
          </div>
        }
      >
        <div className={styles.wrapper}>
          {!canShare ? (
            <div className={styles.notShareable}>
              <h3>
                {!currentUser ? (
                  <FormattedMessage
                    id="shareModal.signInToShare"
                    defaultMessage="Please sign in to share your scene"
                  />
                ) : (
                  <FormattedMessage
                    id="shareModal.saveToShare"
                    defaultMessage="Please save your scene to share it"
                  />
                )}
              </h3>
              {!currentUser && (
                <Button onClick={() => setModal('signin')}>
                  <FormattedMessage {...commonMessages.signInToCloud} />
                </Button>
              )}
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
                    <Button
                      className={styles.changeThumbnailBtn}
                      onClick={() => setModal('screenshot')}
                      variant="toolbtn"
                    >
                      <FormattedMessage
                        id="shareModal.changeThumbnail"
                        defaultMessage="Change Thumbnail"
                      />
                    </Button>
                  </div>
                </div>

                {/* Right side - Scene details */}
                <div className={styles.rightColumn}>
                  <div className={styles.sceneDetails}>
                    <h2 className={styles.sceneTitle}>
                      {sceneData?.title || (
                        <FormattedMessage
                          id="shareModal.untitledScene"
                          defaultMessage="Untitled Scene"
                        />
                      )}
                    </h2>

                    <div
                      className={`${styles.locationInfo} ${!locationString ? styles.placeholder : ''}`}
                    >
                      {locationString || (
                        <FormattedMessage
                          id="shareModal.locationNotSet"
                          defaultMessage="Location not set"
                        />
                      )}
                    </div>

                    <div
                      className={`${styles.authorInfo} ${!authorUsername ? styles.placeholder : ''}`}
                      onClick={() =>
                        authorUsername ? setModal('profile') : null
                      }
                      style={{ cursor: authorUsername ? 'pointer' : 'default' }}
                    >
                      @
                      {authorUsername ||
                        intl.formatMessage({
                          id: 'shareModal.anonymous',
                          defaultMessage: 'anonymous'
                        })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Share buttons section */}
              <div className={styles.shareButtonsSection}>
                <TooltipWrapper
                  content={intl.formatMessage({
                    id: 'shareModal.emailTooltip',
                    defaultMessage: 'Share scene as a new email draft'
                  })}
                  side="top"
                >
                  <Button
                    onClick={handleEmailShare}
                    variant="toolbtn"
                    className={styles.shareButton}
                  >
                    ✉️{' '}
                    <FormattedMessage
                      id="shareModal.emailButton"
                      defaultMessage="Email"
                    />
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper
                  content={intl.formatMessage({
                    id: 'shareModal.osShareTooltip',
                    defaultMessage:
                      "Use your browser's share feature to send your scene to others"
                  })}
                  side="top"
                >
                  <Button
                    onClick={handleOSShare}
                    variant="toolbtn"
                    className={styles.shareButton}
                  >
                    📤 <FormattedMessage {...commonMessages.share} />
                  </Button>
                </TooltipWrapper>
                <TooltipWrapper
                  content={intl.formatMessage({
                    id: 'shareModal.discordTooltip',
                    defaultMessage:
                      'Post this scene to the 3DStreet Discord server to share with other creators'
                  })}
                  side="top"
                >
                  <Button
                    onClick={handleDiscordShare}
                    variant="toolbtn"
                    className={styles.shareButton}
                  >
                    💬 <FormattedMessage {...commonMessages.discord} />
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
                    <FormattedMessage
                      id="shareModal.copyUrl"
                      defaultMessage="Copy URL"
                    />
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
