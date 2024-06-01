import './CameraToolbar.scss';

import { Component } from 'react';

import Events from '../../../lib/Events.js';
import classNames from 'classnames';
import { Hint } from '../../components/Tabs/components/index.js';

const options = [
  {
    value: 'perspective',
    event: 'cameraperspectivetoggle',
    payload: null,
    label: '3D View',
    hint: '3D perspective camera with click and drag rotation'
  },
  // { value: 'ortholeft', event: 'cameraorthographictoggle', payload: 'left', label: 'Left View' },
  // { value: 'orthoright', event: 'cameraorthographictoggle', payload: 'right', label: 'Right View' },
  {
    value: 'orthotop',
    event: 'cameraorthographictoggle',
    payload: 'top',
    label: 'Plan View',
    hint: 'Down facing orthographic camera'
  },
  // { value: 'orthobottom', event: 'cameraorthographictoggle', payload: 'bottom', label: 'Bottom View' },
  // { value: 'orthoback', event: 'cameraorthographictoggle', payload: 'back', label: 'Back View' },
  {
    value: 'orthofront',
    event: 'cameraorthographictoggle',
    payload: 'front',
    label: 'Cross Section',
    hint: 'Front facing orthographic camera'
  }
];

class CameraToolbar extends Component {
  state = {
    selectedCamera: 'perspective',
    areChangesEmitted: false
  };

  componentDidMount() {
    setTimeout(() => {
      this.setInitialCamera();
    }, 1);
  }

  componentWillUnmount() {
    clearTimeout(() => {
      this.setInitialCamera();
    }, 1);
  }

  setInitialCamera = () => {
    if (!this.state.areChangesEmitted) {
      const selectedOption = options.find(
        ({ value }) => this.state.selectedCamera === value
      );

      this.handleCameraChange(selectedOption);
    }

    Events.on('cameratoggle', (data) =>
      this.setState({ selectedCamera: data.value })
    );
  };

  handleCameraChange(option) {
    this.setState({ selectedCamera: option.value, areChangesEmitted: true });
    Events.emit(option.event, option.payload);
  }

  render() {
    const className = classNames({
      open: this.state.menuIsOpen
    });
    return (
      <div id={'cameraToolbar'} className={className}>
        {options.map(({ label, value, event, payload, hint }) => (
          <button
            className={classNames(
              this.state.selectedCamera === value && 'selectedCamera'
            )}
            type={'button'}
            onClick={() => this.handleCameraChange({ value, event, payload })}
            key={value}
          >
            {label}
            <Hint hint={hint} tab={value} />
          </button>
        ))}
      </div>
    );
  }
}

export { CameraToolbar };
