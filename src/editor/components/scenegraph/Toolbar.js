import React, { Component } from 'react';
import { checkIfImagePathIsEmpty, uploadThumbnailImage } from '../../api/scene';
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
import { makeScreenshot, saveScene } from '@/editor/lib/SceneUtils';

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
    makeScreenshot();
    const currentSceneId = await this.saveScene({ doSaveAs });
    const isImagePathEmpty = await checkIfImagePathIsEmpty(currentSceneId);
    if (isImagePathEmpty) {
      await uploadThumbnailImage();
    }
  };

  newHandler = () => {
    posthog.capture('new_scene_clicked');
    useStore.getState().setModal('new');
  };

  saveScene = async ({ doSaveAs = false }) => {
    try {
      this.setState({ isSavingScene: true });
      const currentSceneId = await saveScene(this.props.currentUser, doSaveAs);
      this.setState({ isSaveActionActive: false });
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
      this.saveScene({ doSaveAs: false });
    }
  }, 1000);

  handleUnsignedSaveClick = () => {
    posthog.capture('remix_scene_clicked');
    this.setState({ pendingSceneSave: true });
    useStore.getState().setModal('signin');
  };

  toggleSaveActionState = () => {
    this.setState((prevState) => ({
      isSaveActionActive: !prevState.isSaveActionActive
    }));
  };

  render() {
    console.log(this.props.currentUser);
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
                          onClick={this.saveScene}
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
                          <div>Make a Copy</div>
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
                    makeScreenshot();
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
