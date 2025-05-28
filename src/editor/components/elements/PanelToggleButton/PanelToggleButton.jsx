import PropTypes from 'prop-types';
import classNames from 'classnames';
import styles from './PanelToggleButton.module.scss';

export const PanelToggleButton = ({
  icon: Icon,
  isOpen,
  onClick,
  className,
  children
}) => {
  return (
    <button
      onClick={onClick}
      className={classNames(styles.panelToggleButton, className, {
        [styles.active]: isOpen
      })}
    >
      {Icon && <Icon className={styles.icon} />}
      {children}
    </button>
  );
};

PanelToggleButton.propTypes = {
  icon: PropTypes.elementType,
  isOpen: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
  className: PropTypes.string,
  children: PropTypes.node
};
