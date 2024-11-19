import React, { Component } from 'react';
import {
  createScene,
  updateScene,
  checkIfImagePathIsEmpty,
  uploadThumbnailImage
} from '../../api/scene';
import {
  Cloud24Icon,
  Save24Icon,
  ScreenshotIcon,
  Upload24Icon,
  Edit24Icon
} from '../../icons';
import Events from '../../lib/Events';
import { Button, ProfileButton, Logo } from '../components';
import posthog from 'posthog-js';
import { UndoRedo } from '../components/UndoRedo';
import debounce from 'lodash-es/debounce';
import { CameraToolbar } from '../viewport/CameraToolbar';
import useStore from '@/store';

// const LOCALSTORAGE_MOCAP_UI = "aframeinspectormocapuienabled";

/**
 * Tools and actions.
 */
export default class Toolbar extends Component {
  constructor(props) {
    super(props);
    this.state = {
      isSaveActionActive: false,
      showLoadBtn: true,
      isSavingScene: false,
      savedScene: false,
      pendingSceneSave: false,
      inspectorEnabled: true
    };
    this.saveButtonRef = React.createRef();
  }

  componentDidMount() {
    document.addEventListener('click', this.handleClickOutsideSave);
    Events.on('historychanged', (cmd) => {
      if (cmd) {
        // Debounce the cloudSaveHandler call
        this.debouncedCloudSaveHandler();
      }
    });
    // Subscribe to store changes
    this.unsubscribe = useStore.subscribe(
      (state) => state.isInspectorEnabled,
      (isInspectorEnabled) => {
        this.setState({ inspectorEnabled: isInspectorEnabled });
      }
    );
  }

  componentDidUpdate(prevProps) {
    if (this.props.currentUser !== prevProps.currentUser) {
      if (this.state.pendingSceneSave && this.props.currentUser) {
        // Remove the flag from state, as we're going to handle the save now.
        this.setState({ pendingSceneSave: false });
        this.cloudSaveHandlerWithImageUpload();
      }
    }
  }

  componentWillUnmount() {
    document.removeEventListener('click', this.handleClickOutsideSave);
    // Unsubscribe from store changes
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  isAuthor = () => {
    return this.props.currentUser?.uid === STREET.utils.getAuthorId();
  };

  handleClickOutsideSave = (event) => {
    if (
      this.saveButtonRef.current &&
      !this.saveButtonRef.current.contains(event.target)
    ) {
      this.setState({ isSaveActionActive: false });
    }
  };

  cloudSaveHandlerWithImageUpload = async (doSaveAs) => {
    this.makeScreenshot();
    const currentSceneId = await this.cloudSaveHandler({ doSaveAs });
    const isImagePathEmpty = await checkIfImagePathIsEmpty(currentSceneId);
    if (isImagePathEmpty) {
      await uploadThumbnailImage();
    }
  };

  newHandler = () => {
    posthog.capture('new_scene_clicked');
    AFRAME.INSPECTOR.selectEntity(null);
    useStore.getState().newScene();
    STREET.utils.newScene();
    AFRAME.scenes[0].emit('newScene');
  };

  cloudSaveHandler = async ({ doSaveAs = false }) => {
    try {
      // if there is no current user, show sign in modal
      let currentSceneId = STREET.utils.getCurrentSceneId();
      let currentSceneTitle = useStore.getState().sceneTitle;

      posthog.capture('save_scene_clicked', {
        save_as: doSaveAs,
        user_id: this.props.currentUser ? this.props.currentUser.uid : null,
        scene_id: currentSceneId,
        scene_title: currentSceneTitle
      });

      if (!this.props.currentUser) {
        console.log('no user');
        useStore.getState().setModal('signin');
        return;
      }

      // check if the user is not pro, and if the geospatial has array of values of mapbox
      const streetGeo = document
        .getElementById('reference-layers')
        ?.getAttribute('street-geo');
      if (
        !this.props.currentUser.isPro &&
        streetGeo &&
        streetGeo['latitude'] &&
        streetGeo['longitude']
      ) {
        useStore.getState().setModal('payment');
        return;
      }
      if (!this.isAuthor()) {
        posthog.capture('not_scene_author', {
          scene_id: currentSceneId,
          user_id: this.props.currentUser.uid
        });
        doSaveAs = true;
      }

      // generate json from 3dstreet core
      const entity = document.getElementById('street-container');
      const data = STREET.utils.convertDOMElToObject(entity);
      const filteredData = JSON.parse(STREET.utils.filterJSONstreet(data));
      this.setState({ isSavingScene: true });

      // we want to save, so if we *still* have no sceneID at this point, then create a new one
      if (!currentSceneId || !!doSaveAs) {
        // ask user for scene title here currentSceneTitle
        let newSceneTitle = prompt('Scene Title:', currentSceneTitle || '');

        if (newSceneTitle) {
          currentSceneTitle = newSceneTitle;
        }

        useStore.getState().setSceneTitle(currentSceneTitle);
        console.log(
          'no urlSceneId or doSaveAs is true, therefore generate new one'
        );
        currentSceneId = await createScene(
          this.props.currentUser.uid,
          filteredData.data,
          currentSceneTitle,
          filteredData.version
        );
        console.log('newly generated currentSceneId', currentSceneId);
      } else {
        await updateScene(
          currentSceneId,
          filteredData.data,
          currentSceneTitle,
          filteredData.version
        );
      }

      // after all those save shenanigans let's set currentSceneId in state
      this.setState({ currentSceneId });

      // save json to firebase with other metadata

      // make sure to update sceneId with new one in metadata component!
      AFRAME.scenes[0].setAttribute('metadata', 'sceneId', currentSceneId);
      AFRAME.scenes[0].setAttribute(
        'metadata',
        'authorId',
        this.props.currentUser.uid
      );

      // Change the hash URL without reloading
      window.location.hash = `#/scenes/${currentSceneId}.json`;
      this.toggleSaveActionState();
      this.setState({ savedScene: true });
      this.setSavedSceneFalse();

      return currentSceneId;
    } catch (error) {
      STREET.notify.errorMessage(
        `Error trying to save 3DStreet scene to cloud. Error: ${error}`
      );
      console.error(error);
    } finally {
      this.setState({ isSavingScene: false });
    }
  };

  setSavedSceneFalse = debounce(() => {
    this.setState({ savedScene: false });
  }, 500);

  debouncedCloudSaveHandler = debounce(() => {
    if (
      this.props.currentUser &&
      STREET.utils.getAuthorId() === this.props.currentUser.uid
    ) {
      const streetGeo = document
        .getElementById('reference-layers')
        ?.getAttribute('street-geo');
      if (
        !this.props.currentUser.isPro &&
        streetGeo &&
        streetGeo['latitude'] &&
        streetGeo['longitude']
      ) {
        useStore.getState().setModal('payment');
        return;
      }
      this.cloudSaveHandler({ doSaveAs: false });
    }
  }, 1000);

  handleUnsignedSaveClick = () => {
    posthog.capture('remix_scene_clicked');
    this.setState({ pendingSceneSave: true });
    useStore.getState().setModal('signin');
  };

  makeScreenshot = () => {
    const imgHTML = '<img id="screentock-destination">';
    // Set the screenshot in local storage
    localStorage.setItem('screenshot', JSON.stringify(imgHTML));
    const screenshotEl = document.getElementById('screenshot');
    screenshotEl.play();

    screenshotEl.setAttribute('screentock', 'type', 'img');
    screenshotEl.setAttribute(
      'screentock',
      'imgElementSelector',
      '#screentock-destination'
    );
    // take the screenshot
    screenshotEl.setAttribute('screentock', 'takeScreenshot', true);
  };

  toggleSaveActionState = () => {
    this.setState((prevState) => ({
      isSaveActionActive: !prevState.isSaveActionActive
    }));
  };

  render() {
    const isEditor = !!this.state.inspectorEnabled;
    return (
      <div id="toolbar" className="m-4 justify-center">
        <div className="grid grid-flow-dense grid-cols-5">
          <div className="col-span-2">
            <Logo />
          </div>
          {isEditor && (
            <>
              <div className="col-span-1 flex items-center justify-center">
                <CameraToolbar />
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2">
                <Button
                  leadingIcon={<Edit24Icon />}
                  onClick={this.newHandler}
                  disabled={this.state.isSavingScene}
                  variant="toolbtn"
                >
                  <div>New</div>
                </Button>
                {this.props.currentUser ? (
                  <div
                    className="saveButtonWrapper relative w-24"
                    ref={this.saveButtonRef}
                  >
                    {this.state.savedScene ? (
                      <Button variant="filled">
                        <div>Saved</div>
                      </Button>
                    ) : (
                      <Button
                        leadingIcon={<Save24Icon />}
                        onClick={this.toggleSaveActionState.bind(this)}
                        disabled={this.state.isSavingScene}
                        variant="toolbtn"
                      >
                        <div>Save</div>
                      </Button>
                    )}
                    {this.state.isSaveActionActive && (
                      <div className="dropdownedButtons">
                        <Button
                          leadingIcon={<Cloud24Icon />}
                          variant="white"
                          onClick={this.cloudSaveHandler}
                          disabled={
                            this.state.isSavingScene || !this.isAuthor()
                          }
                        >
                          <div>Save</div>
                        </Button>
                        <Button
                          leadingIcon={<Cloud24Icon />}
                          variant="white"
                          onClick={() =>
                            this.cloudSaveHandlerWithImageUpload(true)
                          }
                          disabled={this.state.isSavingScene}
                        >
                          <div>Save As...</div>
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Button
                    leadingIcon={<Save24Icon />}
                    onClick={this.handleUnsignedSaveClick}
                    disabled={this.state.isSavingScene}
                    variant="toolbtn"
                  >
                    <div>Save</div>
                  </Button>
                )}
                {this.state.showLoadBtn && (
                  <Button
                    leadingIcon={<Upload24Icon />}
                    onClick={() => useStore.getState().setModal('scenes')}
                    variant="toolbtn"
                    className="min-w-[105px]"
                  >
                    <div>Open</div>
                  </Button>
                )}
                <Button
                  leadingIcon={<ScreenshotIcon />}
                  onClick={() => {
                    this.makeScreenshot();
                    useStore.getState().setModal('screenshot');
                  }}
                  variant="toolbtn"
                  className="min-w-[105px]"
                >
                  <div>Share</div>
                </Button>
                <div
                  onClick={() =>
                    this.setState((prevState) => ({
                      ...prevState,
                      isSignInModalActive: true
                    }))
                  }
                >
                  <ProfileButton />
                </div>
              </div>
            </>
          )}
        </div>
        {isEditor && (
          <div className="mr-2 mt-2 flex justify-end gap-2 pr-[43px]">
            <UndoRedo />
          </div>
        )}
      </div>
    );
  }
}
