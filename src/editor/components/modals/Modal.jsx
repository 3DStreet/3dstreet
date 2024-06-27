import styles from './Modal.module.scss';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { Cross24Icon } from '../../icons';

export default class Modal extends Component {
  static propTypes = {
    id: PropTypes.string,
    children: PropTypes.oneOfType([PropTypes.array, PropTypes.element])
      .isRequired,
    isOpen: PropTypes.bool,
    extraCloseKeyCode: PropTypes.number,
    closeOnClickOutside: PropTypes.bool,
    onClose: PropTypes.func,
    title: PropTypes.string,
    titleElement: PropTypes.element,
    className: PropTypes.string
  };

  static defaultProps = {
    closeOnClickOutside: true
  };

  constructor(props) {
    super(props);
    this.state = { isOpen: this.props.isOpen };
    this.self = React.createRef();
  }

  componentDidMount() {
    document.addEventListener('keyup', this.handleGlobalKeydown);
    document.addEventListener('mousedown', this.handleGlobalMousedown);
  }

  handleGlobalKeydown = (event) => {
    if (
      this.state.isOpen &&
      (event.keyCode === 27 ||
        (this.props.extraCloseKeyCode &&
          event.keyCode === this.props.extraCloseKeyCode))
    ) {
      this.close();

      // Prevent closing the inspector
      event.stopPropagation();
    }
  };

  shouldClickDismiss = (event) => {
    var target = event.target;
    // This piece of code isolates targets which are fake clicked by things
    // like file-drop handlers
    if (target.tagName === 'INPUT' && target.type === 'file') {
      return false;
    }
    if (target === this.self.current || this.self.current.contains(target)) {
      return false;
    }
    return true;
  };

  handleGlobalMousedown = (event) => {
    if (
      this.props.closeOnClickOutside &&
      this.state.isOpen &&
      this.shouldClickDismiss(event)
    ) {
      if (typeof this.props.onClose === 'function') {
        this.props.onClose();
      }
    }
  };

  componentWillUnmount() {
    document.removeEventListener('keyup', this.handleGlobalKeydown);
    document.removeEventListener('mousedown', this.handleGlobalMousedown);
  }

  static getDerivedStateFromProps(props, state) {
    if (state.isOpen !== props.isOpen) {
      return { isOpen: props.isOpen };
    }
    return null;
  }

  close = () => {
    this.setState({ isOpen: false });
    if (this.props.onClose) {
      this.props.onClose();
    }
  };

  render() {
    const {
      children,
      id,
      title,
      titleElement,
      className,
      currentUser,
      selectedTab
    } = this.props;
    const modalClassName =
      title === 'Open scene' ? 'modal-scene' : 'modal-body';

    return (
      <div
        id={id}
        className={classNames('modal', !this.state.isOpen && 'hide')}
      >
        <div className={classNames('modal-content', className)} ref={this.self}>
          <div
            className={classNames(
              title === 'Open scene' ? 'modal-scene-header' : 'modal-header'
            )}
          >
            <span className={styles.close} onClick={this.close}>
              <Cross24Icon />
            </span>
            {typeof titleElement !== 'undefined' ? (
              titleElement
            ) : (
              <h3
                style={{
                  fontSize: '20px',
                  marginTop: '26px',
                  marginBottom: '0px',
                  position: 'relative'
                }}
              >
                {title}
              </h3>
            )}
          </div>
          <div
            className={
              currentUser || selectedTab !== 'owner'
                ? modalClassName
                : 'modal-sign-in-first'
            }
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
}
