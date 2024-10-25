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
import { Button, ProfileButton } from '../components';
import { sendMetric } from '../../services/ga.js';
import posthog from 'posthog-js';
import { UndoRedo } from '../components/UndoRedo';
import debounce from 'lodash-es/debounce';
// const LOCALSTORAGE_MOCAP_UI = "aframeinspectormocapuienabled";

/**
 * Tools and actions.
 */
export default class Toolbar extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // isPlaying: false,
      isSaveActionActive: false,
      showLoadBtn: true,
      isSavingScene: false,
      pendingSceneSave: false,
      signInSuccess: false,
      isAuthor: props.currentUser?.uid === props.authorId,
      notification: null
    };
    this.saveButtonRef = React.createRef();
  }

  componentDidMount() {
    document.addEventListener('click', this.handleClickOutsideSave);
    this.checkSignInStatus();
    Events.on('historychanged', (cmd) => {
      if (cmd) {
        console.log('historychanged', cmd);
        // Debounce the cloudSaveHandler call
        this.debouncedCloudSaveHandler();
      }
    });
  }

  componentDidUpdate(prevProps) {
    if (this.props.currentUser !== prevProps.currentUser) {
      this.setState({ currentUser: this.props.currentUser });
      this.setState({
        isAuthor: this.props.currentUser?.uid === this.props.authorId
      });
      if (this.state.pendingSceneSave && this.props.currentUser) {
        // Remove the flag from state, as we're going to handle the save now.
        this.setState({ pendingSceneSave: false });
        setTimeout(() => {
          this.cloudSaveHandler({ doSaveAs: true })
            .then(() => {
              // The promise from cloudSaveHandler has resolved, now update the state.
            })
            .catch((error) => {
              // Handle any errors here
              console.error('Save failed:', error);
            });
        }, 500);
      }
    }
  }

  checkSignInStatus = async () => {
    if (this.state.signInSuccess && this.state.pendingSceneSave) {
      if (this.props.currentUser) {
        await this.cloudSaveHandler({ doSaveAs: true });
        this.setState({ signInSuccess: false, pendingSceneSave: false });
      } else {
        setTimeout(this.checkSignInStatus, 500);
      }
    }
  };

  componentWillUnmount() {
    document.removeEventListener('click', this.handleClickOutsideSave);
  }

  handleClickOutsideSave = (event) => {
    if (
      this.saveButtonRef.current &&
      !this.saveButtonRef.current.contains(event.target)
    ) {
      this.setState({ isSaveActionActive: false });
    }
  };

  static convertToObject = () => {
    try {
      posthog.capture('convert_to_json_clicked', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
      const entity = document.getElementById('street-container');

      const data = STREET.utils.convertDOMElToObject(entity);

      const jsonString = `data:text/json;chatset=utf-8,${encodeURIComponent(
        STREET.utils.filterJSONstreet(data)
      )}`;

      const link = document.createElement('a');
      link.href = jsonString;
      link.download = 'data.json';

      link.click();
      link.remove();
      STREET.notify.successMessage('3DStreet JSON file saved successfully.');
    } catch (error) {
      STREET.notify.errorMessage(
        `Error trying to save 3DStreet JSON file. Error: ${error}`
      );
      console.error(error);
    }
  };

  cloudSaveAsHandler = async () => {
    this.cloudSaveHandler({ doSaveAs: true });
  };

  newHandler = () => {
    AFRAME.INSPECTOR.selectEntity(null);
    STREET.utils.newScene();
    AFRAME.scenes[0].emit('newScene');
  };

  cloudSaveHandler = async ({ doSaveAs = false }) => {
    try {
      if (this.state.notification) {
        STREET.notify.dismissNotification(this.state.notification);
      }
      // if there is no current user, show sign in modal
      let currentSceneId = STREET.utils.getCurrentSceneId();
      let currentSceneTitle = STREET.utils.getCurrentSceneTitle();

      posthog.capture('save_scene_clicked', {
        save_as: doSaveAs,
        user_id: this.props.currentUser ? this.props.currentUser.uid : null,
        scene_id: currentSceneId,
        scene_title: currentSceneTitle
      });

      if (!this.props.currentUser) {
        console.log('no user');
        Events.emit('opensigninmodal');
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
        Events.emit('openpaymentmodal');
        return;
      }
      if (!this.state.isAuthor) {
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
        let newSceneTitle = prompt('Scene Title:', currentSceneTitle);

        if (newSceneTitle) {
          currentSceneTitle = newSceneTitle;
        }
        AFRAME.scenes[0].setAttribute(
          'metadata',
          'sceneTitle',
          currentSceneTitle
        );

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
      AFRAME.scenes[0].setAttribute('metadata', 'sceneId: ' + currentSceneId);

      const isImagePathEmpty = await checkIfImagePathIsEmpty(currentSceneId);
      if (isImagePathEmpty) {
        await uploadThumbnailImage();
      }

      // Change the hash URL without reloading
      window.location.hash = `#/scenes/${currentSceneId}.json`;
      const notification = STREET.notify.successMessage('Scene saved');
      this.setState({ notification });

      this.setState({ isAuthor: true });
      sendMetric('SaveSceneAction', doSaveAs ? 'saveAs' : 'save');
    } catch (error) {
      STREET.notify.errorMessage(
        `Error trying to save 3DStreet scene to cloud. Error: ${error}`
      );
      console.error(error);
    } finally {
      this.setState({ isSavingScene: false });
    }
  };

  debouncedCloudSaveHandler = debounce(() => {
    if (this.state.currentUser) {
      const streetGeo = document
        .getElementById('reference-layers')
        ?.getAttribute('street-geo');
      if (
        !this.props.currentUser.isPro &&
        streetGeo &&
        streetGeo['latitude'] &&
        streetGeo['longitude']
      ) {
        Events.emit('openpaymentmodal');
        return;
      }
      this.cloudSaveHandler({ doSaveAs: false });
    }
  }, 1000);

  handleRemixClick = () => {
    posthog.capture('remix_scene_clicked');
    if (!this.props.currentUser) {
      this.setState({ pendingSceneSave: true });
      Events.emit('opensigninmodal');
    } else {
      this.cloudSaveHandler({ doSaveAs: true });
    }
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

  toggleScenePlaying = () => {
    if (this.state.isPlaying) {
      AFRAME.scenes[0].pause();
      this.setState((prevState) => ({ ...prevState, isPlaying: false }));
      Events.emit('sceneplayingtoggle', false);
      AFRAME.scenes[0].isPlaying = true;
      document.getElementById('aframeInspectorMouseCursor').play();
      return;
    }
    AFRAME.scenes[0].isPlaying = false;
    AFRAME.scenes[0].play();
    this.setState((prevState) => ({ ...prevState, isPlaying: true }));
    Events.emit('sceneplayingtoggle', true);
  };

  toggleSaveActionState = () => {
    this.makeScreenshot();
    this.setState((prevState) => ({
      isSaveActionActive: !prevState.isSaveActionActive
    }));
  };

  toggleLoadActionState = () => {
    this.setState((prevState) => ({
      isLoadActionActive: !prevState.isLoadActionActive
    }));
  };

  render() {
    return (
      <div id="toolbar">
        <div className="toolbarActions">
          <div>
            <Button
              leadingIcon={<Edit24Icon />}
              onClick={this.newHandler}
              disabled={this.state.isSavingScene}
            >
              <div className="hideInLowResolution">New</div>
            </Button>
          </div>
          {this.props.currentUser ? (
            <div className="saveButtonWrapper" ref={this.saveButtonRef}>
              <Button
                leadingIcon={<Save24Icon />}
                onClick={this.toggleSaveActionState.bind(this)}
                disabled={this.state.isSavingScene}
              >
                <div className="hideInLowResolution">Save</div>
              </Button>
              {this.state.isSaveActionActive && (
                <div className="dropdownedButtons">
                  <Button
                    leadingIcon={<Cloud24Icon />}
                    variant="white"
                    onClick={this.cloudSaveHandler}
                    disabled={this.state.isSavingScene || !this.state.isAuthor}
                  >
                    <div>Save</div>
                  </Button>
                  <Button
                    leadingIcon={<Cloud24Icon />}
                    variant="white"
                    onClick={this.cloudSaveAsHandler}
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
              onClick={this.handleRemixClick}
              disabled={this.state.isSavingScene}
            >
              <div className="hideInLowResolution">Save</div>
            </Button>
          )}
          {this.state.showLoadBtn && (
            <Button
              leadingIcon={<Upload24Icon />}
              onClick={() => Events.emit('openscenesmodal')}
            >
              <div className="hideInLowResolution">Open</div>
            </Button>
          )}
          <Button
            leadingIcon={<ScreenshotIcon />}
            onClick={() => {
              this.makeScreenshot();
              Events.emit('openscreenshotmodal');
            }}
          >
            <div className="hideInLowResolution">Share</div>
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
        <div className="undoRedoActions">
          <UndoRedo />
        </div>
      </div>
    );
  }
}
