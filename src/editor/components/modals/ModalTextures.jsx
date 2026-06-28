import React from 'react';
import PropTypes from 'prop-types';
import { FormattedMessage, injectIntl } from 'react-intl';
import Events from '../../lib/Events';
import Modal from '@shared/components/Modal/Modal.jsx';
import {
  getFilename,
  getIdFromUrl,
  insertNewAsset,
  isValidId
} from '../../lib/assetsUtils';

class ModalTextures extends React.Component {
  static propTypes = {
    isOpen: PropTypes.bool,
    onClose: PropTypes.func,
    selectedTexture: PropTypes.string,
    intl: PropTypes.object
  };

  constructor(props) {
    super(props);
    this.state = {
      filterText: '',
      isOpen: this.props.isOpen,
      loadedTextures: [],
      assetsImages: [],
      registryImages: [],
      addNewDialogOpened: false,
      newUrl: '',
      preview: {
        width: 0,
        height: 0,
        src: '',
        id: '',
        name: '',
        filename: '',
        type: '',
        value: '',
        loaded: false
      }
    };
    this.imageName = React.createRef();
    this.preview = React.createRef();
    this.registryGallery = React.createRef();
  }

  onAssetsImagesLoad = (images) => {
    this.generateFromRegistry();
  };

  componentDidMount() {
    Events.on('assetsimagesload', this.onAssetsImagesLoad);
    this.generateFromAssets();
  }

  componentWillUnmount() {
    Events.off('assetsimagesload', this.onAssetsImagesLoad);
  }

  componentDidUpdate(prevProps) {
    if (this.state.isOpen && !AFRAME.INSPECTOR.assetsLoader.hasLoaded) {
      AFRAME.INSPECTOR.assetsLoader.load();
    }
    if (this.state.isOpen && this.state.isOpen !== prevProps.isOpen) {
      this.generateFromAssets();
    }
  }

  static getDerivedStateFromProps(props, state) {
    if (state.isOpen !== props.isOpen) {
      return { isOpen: props.isOpen };
    }
    return null;
  }

  onClose = (value) => {
    if (this.props.onClose) {
      this.props.onClose();
    }
  };

  selectTexture = (value) => {
    if (this.props.onClose) {
      this.props.onClose(value);
    }
  };

  generateFromRegistry = () => {
    var self = this;
    AFRAME.INSPECTOR.assetsLoader.images.forEach((imageData) => {
      var image = new Image();
      image.addEventListener('load', () => {
        self.state.registryImages.push({
          id: imageData.id,
          src: imageData.fullPath,
          width: imageData.width,
          height: imageData.height,
          name: imageData.id,
          type: 'registry',
          tags: imageData.tags,
          value: 'url(' + imageData.fullPath + ')'
        });
        self.setState({ registryImages: self.state.registryImages.slice() });
      });
      image.src = imageData.fullThumbPath;
    });
  };

  generateFromAssets = () => {
    this.setState({ assetsImages: [] });

    var self = this;
    Array.prototype.slice
      .call(document.querySelectorAll('a-assets img'))
      .forEach((asset) => {
        var image = new Image();
        image.addEventListener('load', () => {
          self.state.assetsImages.push({
            id: asset.id,
            src: image.src,
            width: image.width,
            height: image.height,
            name: asset.id,
            type: 'asset',
            value: '#' + asset.id
          });
          self.setState({ assetsImages: self.state.assetsImages });
        });
        image.src = asset.src;
      });
  };

  onNewUrl = (event) => {
    if (event.keyCode !== 13) {
      return;
    }

    var self = this;
    function onImageLoaded(img) {
      var src = self.preview.current.src;
      var name = getFilename(src, true);
      var existingAssetId = getIdFromUrl(src);
      if (existingAssetId) {
        name = existingAssetId;
      }
      self.setState({
        preview: {
          width: self.preview.current.naturalWidth,
          height: self.preview.current.naturalHeight,
          src: src,
          id: '',
          name: name,
          filename: getFilename(src),
          type: existingAssetId ? 'asset' : 'new',
          loaded: true,
          value: 'url(' + src + ')'
        }
      });
      self.preview.current.removeEventListener('load', onImageLoaded);
    }
    this.preview.current.addEventListener('load', onImageLoaded);
    this.preview.current.src = event.target.value;

    this.imageName.current.focus();
  };

  onNameChanged = (event) => {
    var state = this.state.preview;
    state.name = event.target.value;
    this.setState({ preview: state });
  };

  toggleNewDialog = () => {
    this.setState({ addNewDialogOpened: !this.state.addNewDialogOpened });
    this.clear();
  };

  clear() {
    this.setState({
      preview: {
        width: 0,
        height: 0,
        src: '',
        id: '',
        filename: '',
        name: '',
        type: '',
        loaded: false,
        value: ''
      },
      newUrl: ''
    });
  }

  onUrlChange = (e) => {
    this.setState({ newUrl: e.target.value });
  };

  addNewAsset = () => {
    if (this.state.preview.type === 'asset') {
      return;
    }

    insertNewAsset(
      'img',
      this.state.preview.name,
      this.state.preview.src,
      () => {
        this.generateFromAssets();
        this.setState({ addNewDialogOpened: false });
        this.clear();
      }
    );
  };

  onChangeFilter = (e) => {
    this.setState({ filterText: e.target.value });
  };

  renderRegistryImages() {
    var self = this;
    let selectSample = function (image) {
      let name = getFilename(image.name, true);
      const existingAssetId = getIdFromUrl(image.src);
      if (existingAssetId) {
        name = existingAssetId;
      }
      self.setState({
        preview: {
          width: image.width,
          height: image.height,
          src: image.src,
          id: '',
          name: name,
          filename: getFilename(image.src),
          type: existingAssetId ? 'asset' : 'registry',
          loaded: true,
          value: 'url(' + image.src + ')'
        }
      });
      self.imageName.current.focus();
    };

    var filterText = this.state.filterText.toUpperCase();

    return this.state.registryImages
      .filter((image) => {
        return (
          image.id.toUpperCase().indexOf(filterText) > -1 ||
          image.name.toUpperCase().indexOf(filterText) > -1 ||
          image.tags.indexOf(filterText) > -1
        );
      })
      .map(function (image) {
        let imageClick = selectSample.bind(this, image);
        return (
          <li key={image.src} onClick={imageClick}>
            <img width="155px" height="155px" src={image.src} />
            <div className="detail">
              <span className="title">{image.name}</span>
              <span>{getFilename(image.src)}</span>
              <span>
                {image.width} x {image.height}
              </span>
            </div>
          </li>
        );
      });
  }

  render() {
    let isOpen = this.state.isOpen;
    let loadedTextures = this.state.loadedTextures;
    let preview = this.state.preview;

    let validId = isValidId(this.state.preview.name);
    let assetIdTaken =
      validId && !!document.getElementById(this.state.preview.name);
    let validAsset =
      this.state.preview.loaded &&
      validId &&
      !assetIdTaken &&
      this.state.preview.type !== 'asset';

    const { intl } = this.props;
    let addNewAssetButton = this.state.addNewDialogOpened
      ? intl.formatMessage({ id: 'modalTextures.back', defaultMessage: 'BACK' })
      : intl.formatMessage({
          id: 'modalTextures.loadTexture',
          defaultMessage: 'LOAD TEXTURE'
        });

    return (
      <Modal
        id="textureModal"
        title={intl.formatMessage({
          id: 'modalTextures.title',
          defaultMessage: 'Textures'
        })}
        isOpen={isOpen}
        onClose={this.onClose}
        closeOnClickOutside={false}
      >
        <button onClick={this.toggleNewDialog}>{addNewAssetButton}</button>
        <div className={this.state.addNewDialogOpened ? '' : 'hide'}>
          <div className="newimage">
            <div className="new_asset_options">
              <span>
                <FormattedMessage
                  id="modalTextures.loadFromSources"
                  defaultMessage="Load a new texture from one of these sources:"
                />
              </span>
              <ul>
                <li>
                  <span>
                    <FormattedMessage
                      id="modalTextures.fromUrl"
                      defaultMessage="From URL (and press Enter):"
                    />
                  </span>{' '}
                  <input
                    type="text"
                    className="imageUrl"
                    value={this.state.newUrl}
                    onChange={this.onUrlChange}
                    onKeyUp={this.onNewUrl}
                    spellCheck="false"
                  />
                </li>
                <li>
                  <span>
                    <FormattedMessage
                      id="modalTextures.fromAssetsRegistry"
                      defaultMessage="From assets registry:"
                    />{' '}
                  </span>
                  <div className="assets search">
                    <input
                      placeholder={intl.formatMessage({
                        id: 'modalTextures.filterPlaceholder',
                        defaultMessage: 'Filter...'
                      })}
                      value={this.state.filterText}
                      onChange={this.onChangeFilter}
                    />
                    <span className="fa fa-search" />
                  </div>
                  <ul ref={this.registryGallery} className="gallery">
                    {this.renderRegistryImages()}
                  </ul>
                </li>
              </ul>
            </div>
            <div className="preview">
              <FormattedMessage
                id="modalTextures.nameLabel"
                defaultMessage="Name:"
              />{' '}
              <input
                ref={this.imageName}
                className={
                  this.state.preview.name.length > 0 &&
                  (!validId || assetIdTaken)
                    ? 'error'
                    : ''
                }
                readOnly={preview.type === 'asset'}
                type="text"
                value={this.state.preview.name}
                onChange={this.onNameChanged}
                onKeyUp={(event) => {
                  if (event.keyCode === 13 && validAsset) {
                    this.addNewAsset();
                  }
                }}
                spellCheck="false"
              />
              {preview.type !== 'asset' && assetIdTaken && (
                <div className="iderror">
                  <FormattedMessage
                    id="modalTextures.nameTaken"
                    defaultMessage="Name already taken by another asset or entity"
                  />
                </div>
              )}
              {this.state.preview.name.length > 0 && !validId && (
                <div className="iderror">
                  <FormattedMessage
                    id="modalTextures.nameNotValid"
                    defaultMessage="Name is not valid"
                  />
                </div>
              )}
              {preview.type === 'asset' && (
                <div className="iderror">
                  <FormattedMessage
                    id="modalTextures.textureAlreadyLoaded"
                    defaultMessage="Texture already loaded"
                  />
                </div>
              )}
              <img
                ref={this.preview}
                width="155px"
                height="155px"
                src={preview.src}
              />
              {this.state.preview.loaded ? (
                <div className="detail">
                  <span className="title" title={preview.filename}>
                    {preview.filename}
                  </span>
                  <br />
                  <span>
                    {preview.width} x {preview.height}
                  </span>
                </div>
              ) : (
                <span />
              )}
              <br />
              <button disabled={!validAsset} onClick={this.addNewAsset}>
                <FormattedMessage
                  id="modalTextures.loadThisTexture"
                  defaultMessage="LOAD THIS TEXTURE"
                />
              </button>
            </div>
          </div>
        </div>
        <div className={this.state.addNewDialogOpened ? 'hide' : ''}>
          <ul className="gallery">
            {this.state.assetsImages
              .sort(function (a, b) {
                return a.id > b.id;
              })
              .map(
                function (image) {
                  let textureClick = this.selectTexture.bind(this, image);
                  var selectedClass =
                    this.props.selectedTexture === '#' + image.id
                      ? 'selected'
                      : '';
                  return (
                    <li
                      key={image.id}
                      onClick={textureClick}
                      className={selectedClass}
                    >
                      <img width="155px" height="155px" src={image.src} />
                      <div className="detail">
                        <span className="title">{image.name}</span>
                        <span>{getFilename(image.src)}</span>
                        <span>
                          {image.width} x {image.height}
                        </span>
                      </div>
                    </li>
                  );
                }.bind(this)
              )}
            {loadedTextures.map(function (texture) {
              var image = texture.image;
              let textureClick = this.selectTexture.bind(this, texture);
              return (
                <li key={texture.uuid} onClick={textureClick}>
                  <img width="155px" height="155px" src={image.src} />
                  <div className="detail">
                    <span className="title">
                      <FormattedMessage
                        id="modalTextures.nameLabel"
                        defaultMessage="Name:"
                      />
                    </span>{' '}
                    <span>{image.name}</span>
                    <span className="title">
                      <FormattedMessage
                        id="modalTextures.filenameLabel"
                        defaultMessage="Filename:"
                      />
                    </span>{' '}
                    <span>{getFilename(image.src)}</span>
                    <span>
                      {image.width} x {image.height}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>
    );
  }
}

export default injectIntl(ModalTextures);
