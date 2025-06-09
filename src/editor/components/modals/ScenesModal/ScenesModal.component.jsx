import { useEffect, useState } from 'react';
import { useAuthContext } from '../../../contexts';
import { Button, SceneCard, Tabs } from '../../elements';
import Modal from '../Modal.jsx';
import styles from './ScenesModal.module.scss';
import { createElementsForScenesFromJSON } from '@/editor/lib/SceneUtils.js';
import { getCommunityScenes, getUserScenes } from '../../../api/scene';
import { Loader, Upload24Icon } from '../../../icons';
import { signIn } from '../../../api';
import posthog from 'posthog-js';
import useStore from '../../../../store.js';
import { fileJSON } from '@/editor/lib/SceneUtils';
import { searchUsersByUsername } from '../../../utils/username';

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

const ScenesModal = ({ initialTab = 'owner', delay = undefined }) => {
  const { currentUser } = useAuthContext();
  const [renderComponent, setRenderComponent] = useState(!delay);
  const [scenesData, setScenesData] = useState([]);
  const [scenesDataCommunity, setScenesDataCommunity] = useState([]);
  const [filteredCommunityScenes, setFilteredCommunityScenes] = useState([]);
  const [totalDisplayedUserScenes, setTotalDisplayedUserScenes] =
    useState(SCENES_PER_PAGE);
  const [totalDisplayedCommunityScenes, setTotalDisplayedCommunityScenes] =
    useState(SCENES_PER_PAGE);
  const [isLoadingScenes, setIsLoadingScenes] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState(initialTab);
  const [usernameSearch, setUsernameSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'scenes');
  const handleSceneClick = (scene, event) => {
    posthog.capture('scene_opened', {
      scene_id: scene.id,
      scene_title: scene.title,
      selected_tab: selectedTab
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
      // Store both data and memory for new tab
      const fullData = {
        data: sceneData.data,
        memory: sceneData.memory
      };
      localStorage.setItem('sceneData', JSON.stringify(fullData));
      const newTabUrl = `#/scenes/${scene.id}`;
      const newTab = window.open(newTabUrl, '_blank');
      newTab.focus();
    } else {
      // Log memory data for debugging
      if (sceneData.memory) {
        console.log('Loading scene with memory data:', sceneData.memory);
      } else {
        console.log('No memory data found in scene data');
      }

      // Pass both data and memory to createElementsForScenesFromJSON
      createElementsForScenesFromJSON(sceneData.data, sceneData.memory);
      window.location.hash = `#/scenes/${scene.id}`;

      const sceneId = scene.id;
      const sceneTitle = sceneData.title;
      AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
      useStore.getState().setSceneTitle(sceneTitle);
      AFRAME.scenes[0].setAttribute('metadata', 'authorId', sceneData.author);
      STREET.notify.successMessage('Scene loaded from 3DStreet Cloud.');
      onClose();
    }
  };

  useEffect(() => {
    const storedData = JSON.parse(localStorage.getItem('sceneData'));
    if (storedData) {
      if (storedData.data) {
        // New format with separate data and memory
        console.log('Loading scene from localStorage with new format');
        if (storedData.memory) {
          console.log('Memory data found in localStorage:', storedData.memory);
        }
        createElementsForScenesFromJSON(storedData.data, storedData.memory);
      } else {
        // Old format with just data
        console.log('Loading scene from localStorage with old format');
        createElementsForScenesFromJSON(storedData);
      }
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
      setFilteredCommunityScenes([]);
      setTotalDisplayedUserScenes(SCENES_PER_PAGE);
      setTotalDisplayedCommunityScenes(SCENES_PER_PAGE);
      setUsernameSearch('');
      setSelectedUserId(null);
    }
  }, [isOpen]);

  // Handle clicks on the document
  useEffect(() => {
    const handleDocumentClick = (event) => {
      // Close search results dropdown when clicking outside search area
      if (!event.target.closest('[data-search-component]')) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, []);

  useEffect(() => {
    const fetchData = async () => {
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
            setFilteredCommunityScenes(collections);
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

  const onClose = () => {
    setModal(null);
  };

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
      // Only update filtered scenes if no user filter is active
      if (!selectedUserId) {
        setFilteredCommunityScenes([
          ...filteredCommunityScenes,
          ...communityScenes
        ]);
      } else {
        // Filter the new scenes by the selected user ID
        const newFiltered = communityScenes.filter(
          (scene) => scene.data().author === selectedUserId
        );
        setFilteredCommunityScenes([
          ...filteredCommunityScenes,
          ...newFiltered
        ]);
      }
      setTotalDisplayedCommunityScenes(end);
    }

    setIsLoading(false);
  };

  // Handle username search
  const handleUsernameSearch = async (e) => {
    const value = e.target.value;
    // Remove any @ symbol that might be accidentally typed by the user
    const cleanValue = value.replace('@', '');
    setUsernameSearch(cleanValue);

    // If user is editing and we had a filter applied, check if we should clear it
    if (
      selectedUserId &&
      cleanValue !==
        searchResults.find((r) => r.userId === selectedUserId)?.username
    ) {
      // The user has edited away from the selected username, clear the filter
      setSelectedUserId(null);
      setFilteredCommunityScenes(scenesDataCommunity);
    }

    if (cleanValue.length >= 2) {
      setIsSearching(true);
      setShowSearchResults(true);
      try {
        const results = await searchUsersByUsername(cleanValue);
        setSearchResults(results);
      } catch (error) {
        console.error('Error searching for usernames:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    } else {
      setSearchResults([]);
      setShowSearchResults(false);
    }
  };

  // Apply user filter to scenes
  const filterScenesByUser = (userId, username) => {
    setSelectedUserId(userId);
    setUsernameSearch(username); // Store just the username without @
    setShowSearchResults(false);

    if (!userId) {
      // Clear filter - show all community scenes
      setFilteredCommunityScenes(scenesDataCommunity);
    } else {
      // Filter scenes by selected user ID
      const filtered = scenesDataCommunity.filter(
        (scene) => scene.data().author === userId
      );
      setFilteredCommunityScenes(filtered);
    }
  };

  // Clear search
  const clearSearch = () => {
    setUsernameSearch('');
    setSelectedUserId(null);
    setSearchResults([]);
    setShowSearchResults(false);
    setFilteredCommunityScenes(scenesDataCommunity);
  };

  // Handle input focus - show search results if we have any
  const handleInputFocus = () => {
    if (usernameSearch.length >= 2) {
      setShowSearchResults(true);
    }
  };

  // Handle keyboard events for username search
  const handleUsernameKeyDown = (e) => {
    // Enter pressed - commit the current search term
    if (e.key === 'Enter') {
      e.preventDefault();

      // If we have search results, select the first match
      if (searchResults.length > 0) {
        const firstMatch = searchResults[0];
        filterScenesByUser(firstMatch.userId, firstMatch.username);
      }
      // Close the dropdown even if there are no matches
      setShowSearchResults(false);
    }
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
      currentUser={currentUser}
      selectedTab={selectedTab}
      title="Open scene"
      titleElement={
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%'
            }}
          >
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
            <div className={styles.titleButtons}>
              <Button
                leadingIcon={<Upload24Icon />}
                className={styles.uploadBtn}
                style={{ position: 'relative' }}
                size="small"
              >
                Upload 3DStreet JSON File
                <input
                  type="file"
                  onChange={(e) => {
                    fileJSON(e);
                    onClose(); // Close the modal
                  }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0,
                    fontSize: 0,
                    cursor: 'pointer'
                  }}
                  accept=".js, .json, .txt"
                />
              </Button>
            </div>
          </div>
          <div className={styles.header}>
            <div className={styles.leftSection}>
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
              {selectedTab === 'community' && (
                <div className={styles.searchContainer} data-search-component>
                  <div className={styles.searchInputWrapper}>
                    <span className={styles.atSymbol}>@</span>
                    <input
                      type="text"
                      className={styles.searchInput}
                      placeholder="Search by username"
                      value={usernameSearch}
                      onChange={handleUsernameSearch}
                      onFocus={handleInputFocus}
                      onKeyDown={handleUsernameKeyDown}
                    />
                    {usernameSearch && (
                      <button
                        className={styles.clearButton}
                        onClick={clearSearch}
                        aria-label="Clear search"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  {showSearchResults && (
                    <div className={styles.searchResults} data-search-component>
                      {isSearching ? (
                        <div className={styles.searchingMessage}>
                          Searching...
                        </div>
                      ) : searchResults.length > 0 ? (
                        searchResults.map((result) => (
                          <div
                            key={result.userId}
                            className={styles.searchResultItem}
                            onClick={() =>
                              filterScenesByUser(result.userId, result.username)
                            }
                          >
                            {result.username}
                          </div>
                        ))
                      ) : usernameSearch.length >= 2 ? (
                        <div className={styles.noResults}>No users found</div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
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
              selectedTab === 'owner' ? scenesData : filteredCommunityScenes
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
