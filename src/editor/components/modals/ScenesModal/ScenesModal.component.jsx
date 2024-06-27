import { useEffect, useState } from 'react';
import { useAuthContext } from '../../../contexts';
import { Button, SceneCard, Tabs } from '../../components';
import Modal from '../Modal.jsx';
import styles from './ScenesModal.module.scss';
import {
  createElementsForScenesFromJSON,
  fileJSON,
  inputStreetmix
} from '../../../lib/toolbar';
import { getCommunityScenes, getUserScenes } from '../../../api/scene';
import Events from '../../../lib/Events';
import { Load24Icon, Loader, Upload24Icon } from '../../../icons';
import { signIn } from '../../../api';
import posthog from 'posthog-js';

const SCENES_PER_PAGE = 20;
const tabs = [
  {
    label: 'My Scenes',
    value: 'owner'
  },
  {
    label: 'Community Scenes',
    value: 'community'
  }
];

const ScenesModal = ({ isOpen, onClose, initialTab = 'owner', delay }) => {
  const { currentUser } = useAuthContext();
  const [renderComponent, setRenderComponent] = useState(!delay);
  const [scenesData, setScenesData] = useState([]);
  const [scenesDataCommunity, setScenesDataCommunity] = useState([]);
  const [totalDisplayedUserScenes, setTotalDisplayedUserScenes] =
    useState(SCENES_PER_PAGE);
  const [totalDisplayedCommunityScenes, setTotalDisplayedCommunityScenes] =
    useState(SCENES_PER_PAGE);
  const [isLoadingScenes, setIsLoadingScenes] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState(initialTab);

  const handleSceneClick = (scene, event) => {
    posthog.capture('scene_opened', {
      scene_id: scene.id,
      scene_title: scene.title
    });
    let sceneData = scene.data();
    if (!sceneData || !sceneData.data) {
      STREET.notify.errorMessage(
        'Error trying to load 3DStreet scene from cloud. Error: Scene data is undefined or invalid.'
      );
      console.error('Scene data is undefined or invalid.');
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      localStorage.setItem('sceneData', JSON.stringify(sceneData.data));
      const newTabUrl = `#/scenes/${scene.id}.json`;
      const newTab = window.open(newTabUrl, '_blank');
      newTab.focus();
    } else {
      createElementsForScenesFromJSON(sceneData.data);
      window.location.hash = `#/scenes/${scene.id}.json`;

      const sceneId = scene.id;
      const sceneTitle = sceneData.title;

      AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
      AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', sceneTitle);

      Events.emit('entitycreate', { element: 'a-entity', components: {} });
      STREET.notify.successMessage('Scene loaded from 3DStreet Cloud.');
      onClose();
    }
  };

  useEffect(() => {
    const sceneData = JSON.parse(localStorage.getItem('sceneData'));
    if (sceneData) {
      createElementsForScenesFromJSON(sceneData);
      localStorage.removeItem('sceneData');
    }
  }, []);

  useEffect(() => {
    if (delay) {
      const timeoutId = setTimeout(() => {
        setRenderComponent(true);
      }, delay);

      return () => clearTimeout(timeoutId);
    }
  }, [delay]);

  useEffect(() => {
    if (!isOpen) {
      setScenesData([]);
      setScenesDataCommunity([]);
      setTotalDisplayedUserScenes(SCENES_PER_PAGE);
      setTotalDisplayedCommunityScenes(SCENES_PER_PAGE);
    }
  }, [isOpen]);

  useEffect(() => {
    const fetchData = async () => {
      console.log({ scenesData, scenesDataCommunity });
      if (isOpen) {
        let collections;
        setIsLoadingScenes(true);

        try {
          if (
            selectedTab === 'owner' &&
            !scenesData.length &&
            currentUser?.uid
          ) {
            collections = await getUserScenes(currentUser.uid, true);
            setScenesData(collections);
          }

          if (selectedTab === 'community' && !scenesDataCommunity.length) {
            collections = await getCommunityScenes(true);
            setScenesDataCommunity(collections);
          }
        } catch (error) {
          AFRAME.scenes[0].components['notify'].message(
            `Error fetching scenes: ${error}`,
            'error'
          );
        } finally {
          setIsLoadingScenes(false);
        }
      }

      if (!isOpen) {
        setScenesData([]);
        setScenesDataCommunity([]);
      }
    };

    fetchData();
  }, [isOpen, currentUser, selectedTab]); // eslint-disable-line

  const fetchUserScenes = async () => {
    return await getUserScenes(currentUser?.uid);
  };

  const fetchCommunityScenes = async () => {
    return await getCommunityScenes();
  };

  const loadData = async (end) => {
    setIsLoading(true);

    if (selectedTab === 'owner') {
      const userScenes = await fetchUserScenes();

      setScenesData([...scenesData, ...userScenes]);
      setTotalDisplayedUserScenes(end);
    } else if (selectedTab === 'community') {
      const communityScenes = await fetchCommunityScenes();

      setScenesDataCommunity([...scenesDataCommunity, ...communityScenes]);
      setTotalDisplayedCommunityScenes(end);
    }

    setIsLoading(false);
  };

  const loadMoreScenes = () => {
    if (selectedTab === 'owner') {
      const start = totalDisplayedUserScenes;
      const end = start + SCENES_PER_PAGE;

      loadData(end);
    } else if (selectedTab === 'community') {
      const start = totalDisplayedCommunityScenes;
      const end = start + SCENES_PER_PAGE;

      loadData(end);
    }
  };

  return renderComponent ? (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
      currentUser={currentUser}
      selectedTab={selectedTab}
      title="Open scene"
      titleElement={
        <>
          <h3
            style={{
              fontSize: '20px',
              marginTop: '26px',
              marginBottom: '0px',
              position: 'relative'
            }}
          >
            Open scene
          </h3>
          <div className={styles.header}>
            <Tabs
              tabs={tabs.map((tab) => {
                return {
                  ...tab,
                  isSelected: selectedTab === tab.value,
                  onClick: () => setSelectedTab(tab.value)
                };
              })}
              className={styles.tabs}
            />
            <div className={styles.buttons}>
              <Button
                onClick={() => {
                  inputStreetmix();
                  onClose(); // Close the modal
                }}
                leadingIcon={<Load24Icon />}
              >
                Load from Streetmix
              </Button>
              <Button
                leadingIcon={<Upload24Icon />}
                className={styles.uploadBtn}
              >
                <label
                  style={{
                    display: 'block',
                    width: '100%',
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="file"
                    onChange={(e) => {
                      fileJSON(e);
                      onClose(); // Close the modal
                    }}
                    style={{ display: 'none' }}
                    accept=".js, .json, .txt"
                  />
                  Upload 3DStreet JSON File
                </label>
              </Button>
            </div>
          </div>
        </>
      }
    >
      <div className={styles.contentWrapper}>
        {isLoadingScenes ? (
          <div className={styles.loadingSpinner}>
            <Loader className={styles.spinner} />
          </div>
        ) : currentUser || selectedTab !== 'owner' ? (
          <SceneCard
            scenesData={
              selectedTab === 'owner' ? scenesData : scenesDataCommunity
            }
            setScenesData={setScenesData}
            isCommunityTabSelected={selectedTab === 'community'}
            handleSceneClick={handleSceneClick}
          />
        ) : (
          <div className={styles.signInFirst}>
            <div className={styles.title}>
              To view your scenes you have to sign in:
            </div>
            <div className={styles.buttons}>
              <Button onClick={() => signIn()}>
                Sign in to 3DStreet Cloud
              </Button>
              <Button
                variant="outlined"
                onClick={() => setSelectedTab('community')}
              >
                View Community Scenes
              </Button>
            </div>
          </div>
        )}
        {!isLoadingScenes && isLoading ? (
          <div className={styles.loadingSpinner}>
            <Loader className={styles.spinner} />
          </div>
        ) : (
          <div className={styles.loadMore}>
            {selectedTab === 'owner' &&
              totalDisplayedUserScenes <= scenesData?.length && (
                <Button className={styles.button} onClick={loadMoreScenes}>
                  Load More
                </Button>
              )}
            {selectedTab === 'community' &&
              totalDisplayedCommunityScenes <= scenesDataCommunity?.length && (
                <Button className={styles.button} onClick={loadMoreScenes}>
                  Load More
                </Button>
              )}
          </div>
        )}
      </div>
    </Modal>
  ) : null;
};

export { ScenesModal };
