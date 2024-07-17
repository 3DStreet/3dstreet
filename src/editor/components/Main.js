import { Button, HelpButton, GeoPanel, Logo, ZoomButtons } from './components';
import { CameraToolbar } from './viewport';
import { Compass32Icon } from '../icons';
import { Component } from 'react';
import ComponentsSidebar from './components/Sidebar';
import Events from '../lib/Events';
import { ModalHelp } from './modals/ModalHelp';
import ModalTextures from './modals/ModalTextures';
import SceneGraph from './scenegraph/SceneGraph';
import { ScreenshotModal } from './modals/ScreenshotModal';
import TransformToolbar from './viewport/TransformToolbar';
// import ViewportHUD from "./viewport/ViewportHUD";
import { SignInModal } from './modals/SignInModal';
import { ProfileModal } from './modals/ProfileModal';
import { firebaseConfig } from '../services/firebase.js';
import { LoadScript } from '@react-google-maps/api';
import { GeoModal } from './modals/GeoModal';
import { ActionBar } from './components/ActionBar';
import { ScenesModal } from './modals/ScenesModal';
import { PaymentModal } from './modals/PaymentModal';
import { SceneEditTitle } from './components/SceneEditTitle';
import { AddLayerPanel } from './components/AddLayerPanel';
import posthog from 'posthog-js';

THREE.ImageUtils.crossOrigin = '';

const isStreetLoaded = window.location.hash.length;
const isPaymentModalOpened = window.location.hash.includes('/modal/payment');

export default class Main extends Component {
  constructor(props) {
    super(props);
    this.state = {
      entity: null,
      inspectorEnabled: true,
      isModalTexturesOpen: false,
      isSignInModalOpened: false,
      isProfileModalOpened: false,
      isAddLayerPanelOpen: false,
      isGeoModalOpened: false,
      isScenesModalOpened: !isStreetLoaded,
      isPaymentModalOpened: isPaymentModalOpened,
      sceneEl: AFRAME.scenes[0],
      visible: {
        scenegraph: true,
        attributes: true
      }
    };

    Events.on('togglesidebar', (event) => {
      if (event.which === 'all') {
        if (this.state.visible.scenegraph || this.state.visible.attributes) {
          this.setState({
            visible: {
              scenegraph: false,
              attributes: false
            }
          });
        } else {
          this.setState({
            visible: {
              scenegraph: true,
              attributes: true
            }
          });
        }
      } else if (event.which === 'attributes') {
        this.setState((prevState) => ({
          visible: {
            ...prevState.visible,
            attributes: !prevState.visible.attributes
          }
        }));
      } else if (event.which === 'scenegraph') {
        this.setState((prevState) => ({
          visible: {
            ...prevState.visible,
            scenegraph: !prevState.visible.scenegraph
          }
        }));
      }
    });
  }

  handleStreetMixURL() {
    const isStreetMix = window.location.hash.includes('streetmix');
    if (isStreetMix) {
      STREET.notify.warningMessage(
        'Hit save if you want to save changes to the scene. Otherwise changes will be lost'
      );
    }
  }

  componentDidMount() {
    const htmlEditorButton = document?.querySelector(
      '.viewer-logo-start-editor-button'
    );
    htmlEditorButton && htmlEditorButton.remove();

    this.handleStreetMixURL();
    window.addEventListener('hashchange', this.handleStreetMixURL);
    Events.on(
      'opentexturesmodal',
      function (selectedTexture, textureOnClose) {
        this.setState({
          selectedTexture: selectedTexture,
          isModalTexturesOpen: true,
          textureOnClose: textureOnClose
        });
      }.bind(this)
    );
    Events.on('entityselect', (entity) => {
      this.setState({ entity: entity });
    });
    Events.on('inspectortoggle', (enabled) => {
      posthog.capture('inspector_toggled', { enabled: enabled });
      this.setState({ inspectorEnabled: enabled });
    });
    Events.on('openhelpmodal', () => {
      posthog.capture('help_modal_opened');
      this.setState({ isHelpOpen: true });
    });
    Events.on('openscreenshotmodal', () => {
      posthog.capture('screenshot_modal_opened');
      this.setState({ isScreenshotOpen: true });
    });
    Events.on('opensigninmodal', () => {
      posthog.capture('signin_modal_opened');
      this.setState({ isSignInModalOpened: true });
    });
    Events.on('openscenesmodal', () => {
      posthog.capture('scenes_modal_opened');
      this.setState({ isScenesModalOpened: true });
    });
    Events.on('openprofilemodal', () => {
      posthog.capture('profile_modal_opened');
      this.setState({ isProfileModalOpened: true });
    });
    Events.on('opengeomodal', () => {
      posthog.capture('geo_modal_opened');
      this.setState({ isGeoModalOpened: true });
    });
    Events.on('openpaymentmodal', () => {
      posthog.capture('payment_modal_opened');
      this.setState({ isPaymentModalOpened: true });
    });
  }

  onCloseHelpModal = (value) => {
    this.setState({ isHelpOpen: false });
  };

  toggleAddLayerPanel = () => {
    posthog.capture('add_layer_panel_opened');
    this.setState((prevState) => ({
      isAddLayerPanelOpen: !prevState.isAddLayerPanelOpen
    }));
  };

  onCloseScreenshotModal = (value) => {
    this.setState({ isScreenshotOpen: false });
  };

  onModalTextureOnClose = (value) => {
    this.setState({ isModalTexturesOpen: false });
    if (this.state.textureOnClose) {
      this.state.textureOnClose(value);
    }
  };

  onCloseSignInModal = () => {
    this.setState({ isSignInModalOpened: false });
  };

  onCloseScenesModal = () => {
    this.setState({ isScenesModalOpened: false });
  };

  onCloseProfileModal = () => {
    this.setState({ isProfileModalOpened: false });
  };

  onCloseGeoModal = () => {
    this.setState({ isGeoModalOpened: false });
  };

  onClosePaymentModal = () => {
    window.location.hash = '#';
    this.setState({ isPaymentModalOpened: false });
  };

  toggleEdit = () => {
    if (this.state.inspectorEnabled) {
      AFRAME.INSPECTOR.close();
    } else {
      AFRAME.INSPECTOR.open();
    }
  };

  renderComponentsToggle() {
    if (
      !this.state.inspectorEnabled ||
      !this.state.entity ||
      this.state.visible.attributes
    ) {
      return null;
    }

    return (
      <div className="toggle-sidebar right">
        <a
          onClick={() => {
            Events.emit('togglesidebar', { which: 'attributes' });
          }}
          className="fa fa-plus"
          title="Show components"
        />
      </div>
    );
  }

  renderSceneGraphToggle() {
    if (!this.state.inspectorEnabled || this.state.visible.scenegraph) {
      return null;
    }
    return (
      <div className="toggle-sidebar left">
        <a
          onClick={() => {
            Events.emit('togglesidebar', { which: 'scenegraph' });
          }}
          className="fa fa-plus"
          title="Show scenegraph"
        />
      </div>
    );
  }

  render() {
    const scene = this.state.sceneEl;
    const isEditor = !!this.state.inspectorEnabled;
    const sceneData = AFRAME.scenes[0].getAttribute('metadata', 'sceneTitle');

    return (
      <div>
        <Logo onToggleEdit={this.toggleEdit} isEditor={isEditor} />
        {this.renderSceneGraphToggle()}
        {this.renderComponentsToggle()}
        {isEditor && (
          <div id="inspectorContainer">
            <SceneGraph
              scene={scene}
              selectedEntity={this.state.entity}
              visible={this.state.visible.scenegraph}
            />
            <div id="viewportBar">
              <CameraToolbar />
              <TransformToolbar />
            </div>
            <div id="rightPanel">
              <ComponentsSidebar
                entity={this.state.entity}
                visible={this.state.visible.attributes}
              />
            </div>
          </div>
        )}
        <ModalHelp
          isOpen={this.state.isHelpOpen}
          onClose={this.onCloseHelpModal}
        />
        <ScreenshotModal
          isOpen={this.state.isScreenshotOpen}
          onClose={this.onCloseScreenshotModal}
        />
        <SignInModal
          isOpen={this.state.isSignInModalOpened}
          onClose={this.onCloseSignInModal}
        />
        <PaymentModal
          isOpen={this.state.isPaymentModalOpened}
          onClose={this.onClosePaymentModal}
        />
        <ScenesModal
          isOpen={this.state.isScenesModalOpened}
          onClose={this.onCloseScenesModal}
          initialTab={isStreetLoaded ? 'owner' : 'community'}
          delay={!isStreetLoaded ? 1500 : undefined}
        />
        <ProfileModal
          isOpen={this.state.isProfileModalOpened}
          onClose={this.onCloseProfileModal}
        />
        <LoadScript
          googleMapsApiKey={firebaseConfig.apiKey}
          libraries={['places']}
        >
          <GeoModal
            isOpen={this.state.isGeoModalOpened}
            onClose={this.onCloseGeoModal}
          />
        </LoadScript>
        <ModalTextures
          isOpen={this.state.isModalTexturesOpen}
          selectedTexture={this.state.selectedTexture}
          onClose={this.onModalTextureOnClose}
        />
        {this.state.inspectorEnabled && (
          <div id="help">
            <HelpButton />
          </div>
        )}
        {this.state.inspectorEnabled && (
          <div id="geo">
            <GeoPanel />
          </div>
        )}
        {this.state.inspectorEnabled && (
          <div id="action-bar">
            <ActionBar
              handleAddClick={this.toggleAddLayerPanel}
              isAddLayerPanelOpen={this.state.isAddLayerPanelOpen}
            />
          </div>
        )}
        {this.state.inspectorEnabled && (
          <div id="scene-title">
            <SceneEditTitle sceneData={sceneData} />
          </div>
        )}
        {this.state.inspectorEnabled && (
          <div id={'zoom-buttons'}>
            <ZoomButtons />
          </div>
        )}
        {this.state.inspectorEnabled && (
          <Button id={'resetZoomButton'}>
            <Compass32Icon />
          </Button>
        )}
        {this.state.inspectorEnabled && this.state.isAddLayerPanelOpen && (
          <AddLayerPanel
            onClose={this.toggleAddLayerPanel}
            isAddLayerPanelOpen={this.state.isAddLayerPanelOpen}
          />
        )}
      </div>
    );
  }
}
