import React, { Component } from 'react';
import {
  generateSceneId,
  updateScene,
  isSceneAuthor,
  checkIfImagePathIsEmpty
} from '../../api/scene';
import {
  Cloud24Icon,
  Save24Icon,
  ScreenshotIcon,
  Upload24Icon,
  Edit24Icon
} from '../../icons';
import Events from '../../lib/Events';
import { saveBlob } from '../../lib/utils';
import { Button, ProfileButton } from '../components';
import { SavingModal } from '../modals/SavingModal';
import { uploadThumbnailImage } from '../modals/ScreenshotModal/ScreenshotModal.component.jsx';
import { sendMetric } from '../../services/ga.js';
import posthog from 'posthog-js';
import { UndoRedo } from '../components/UndoRedo/UndoRedo.component.jsx';
// const LOCALSTORAGE_MOCAP_UI = "aframeinspectormocapuienabled";

function filterHelpers(scene, visible) {
  scene.traverse((o) => {
    if (o.userData.source === 'INSPECTOR') {
      o.visible = visible;
    }
  });
}

function getSceneName(scene) {
  return scene.id || slugify(window.location.host + window.location.pathname);
}

/**
 * Slugify the string removing non-word chars and spaces
 * @param  {string} text String to slugify
 * @return {string}      Slugified string
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w-]+/g, '-') // Replace all non-word chars with -
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
}

/**
 * Tools and actions.
 */
export default class Toolbar extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // isPlaying: false,
      isSaveActionActive: false,
      isCapturingScreen: false,
      showSaveBtn: true,
      showLoadBtn: true,
      savedNewDocument: false,
      isSavingScene: false,
      pendingSceneSave: false,
      signInSuccess: false
    };
    this.saveButtonRef = React.createRef();
  }

  componentDidMount() {
    document.addEventListener('click', this.handleClickOutsideSave);
    this.checkSignInStatus();
  }

  componentDidUpdate(prevProps) {
    if (this.props.currentUser !== prevProps.currentUser) {
      this.setState({ currentUser: this.props.currentUser });

      if (this.state.pendingSceneSave && this.props.currentUser) {
        // Remove the flag from state, as we're going to handle the save now.
        this.setState({ pendingSceneSave: false });
        setTimeout(() => {
          this.cloudSaveHandler({ doSaveAs: true })
            .then(() => {
              // The promise from cloudSaveHandler has resolved, now update the state.
              this.setState({ showSaveBtn: true });
            })
            .catch((error) => {
              // Handle any errors here
              console.error('Save failed:', error);
            });
        }, 500);
      }
    }

    if (
      this.state.isCapturingScreen &&
      prevProps.isCapturingScreen !== this.state.isCapturingScreen
    ) {
      this.makeScreenshot(this);
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
    Events.emit('updatescenegraph');
  };

  cloudSaveHandler = async ({ doSaveAs = false }) => {
    try {
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

      // if owner != doc.id then doSaveAs = true;
      const isCurrentUserTheSceneAuthor = await isSceneAuthor({
        sceneId: currentSceneId,
        authorId: this.props.currentUser.uid
      });

      if (!isCurrentUserTheSceneAuthor) {
        doSaveAs = true;
      }

      // we want to save, so if we *still* have no sceneID at this point, then create a new one
      if (!currentSceneId || !!doSaveAs) {
        console.log(
          'no urlSceneId or doSaveAs is true, therefore generate new one'
        );
        currentSceneId = await generateSceneId(this.props.currentUser.uid);
        console.log('newly generated currentSceneId', currentSceneId);
        window.location.hash = `#/scenes/${currentSceneId}.json`;
        this.setState({ savedNewDocument: true });
      }

      // after all those save shenanigans let's set currentSceneId in state
      this.setState({ currentSceneId });

      // generate json from 3dstreet core
      const entity = document.getElementById('street-container');
      const data = STREET.utils.convertDOMElToObject(entity);
      const filteredData = JSON.parse(STREET.utils.filterJSONstreet(data));
      this.setState({ isSavingScene: true });
      // save json to firebase with other metadata

      await updateScene(
        currentSceneId,
        this.props.currentUser.uid,
        filteredData.data,
        currentSceneTitle,
        filteredData.version
      );

      // make sure to update sceneId with new one in metadata component!
      AFRAME.scenes[0].setAttribute('metadata', 'sceneId: ' + currentSceneId);

      const isImagePathEmpty = await checkIfImagePathIsEmpty(currentSceneId);
      if (isImagePathEmpty) {
        await uploadThumbnailImage(true);
      }

      // Change the hash URL without reloading
      window.location.hash = `#/scenes/${currentSceneId}.json`;
      if (this.state.savedNewDocument) {
        STREET.notify.successMessage(
          'Scene saved to 3DStreet Cloud as a new file.'
        );
        this.setState({ savedNewDocument: false }); // go back to default assumption of save overwrite
      } else {
        STREET.notify.successMessage(
          'Scene saved to 3DStreet Cloud in existing file.'
        );
      }

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

  handleRemixClick = () => {
    posthog.capture('remix_scene_clicked');
    if (!this.props.currentUser) {
      this.setState({ pendingSceneSave: true });
      Events.emit('opensigninmodal');
    } else {
      this.cloudSaveHandler({ doSaveAs: true });
    }
  };

  makeScreenshot = (component) =>
    new Promise((resolve) => {
      // use vanilla js to create an img element as destination for our screenshot
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
      setTimeout(() => resolve(), 1000);
    }).then(() => {
      component &&
        component.setState((prevState) => ({
          ...prevState,
          isCapturingScreen: false
        }));
    });
  // openViewMode() {
  //   AFRAME.INSPECTOR.close();
  // }

  static exportSceneToGLTF() {
    try {
      sendMetric('SceneGraph', 'exportGLTF');
      const sceneName = getSceneName(AFRAME.scenes[0]);
      const scene = AFRAME.scenes[0].object3D;
      posthog.capture('export_scene_to_gltf_clicked', {
        scene_id: STREET.utils.getCurrentSceneId()
      });

      filterHelpers(scene, false);
      AFRAME.INSPECTOR.exporters.gltf.parse(
        scene,
        function (buffer) {
          filterHelpers(scene, true);
          const blob = new Blob([buffer], { type: 'application/octet-stream' });
          saveBlob(blob, sceneName + '.glb');
        },
        function (error) {
          console.error(error);
        },
        { binary: true }
      );
      STREET.notify.successMessage('3DStreet scene exported as glTF file.');
    } catch (error) {
      STREET.notify.errorMessage(
        `Error while trying to save glTF file. Error: ${error}`
      );
      console.error(error);
    }
  }

  addEntity() {
    Events.emit('entitycreate', { element: 'a-entity', components: {} });
  }

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
    this.setState((prevState) => ({
      isCapturingScreen: true,
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
          {this.props.currentUser?.isPro && (
            <div>
              <Button leadingIcon={<Edit24Icon />} onClick={this.newHandler}>
                <div className="hideInLowResolution">New</div>
              </Button>
            </div>
          )}
          {this.state.showSaveBtn && this.props.currentUser ? (
            <div className="saveButtonWrapper" ref={this.saveButtonRef}>
              <Button
                leadingIcon={<Save24Icon />}
                onClick={this.toggleSaveActionState.bind(this)}
              >
                <div className="hideInLowResolution">Save</div>
              </Button>
              {this.state.isSavingScene && <SavingModal />}
              {this.state.isSaveActionActive && (
                <div className="dropdownedButtons">
                  <Button
                    leadingIcon={<Cloud24Icon />}
                    variant="white"
                    onClick={this.cloudSaveHandler}
                    disabled={this.state.isSavingScene || !this.props.isAuthor}
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
              this.setState((prevState) => ({
                ...prevState,
                isCapturingScreen: true
              }));
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
