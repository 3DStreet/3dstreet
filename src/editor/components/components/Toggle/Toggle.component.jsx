import { bool, func, shape, string } from 'prop-types';

import classNames from 'classnames';
import styles from './Toggle.module.scss';
import { v4 } from 'uuid';

const toggleId = v4();

/**
 * Toggle component.
 *
 * @author Oleksii Medvediev
 * @category Components
 * @param {{
 *  status: boolean;
 *  onChange: (value: boolean) => void;
 *  disabled?: boolean;
 *  className?: string;
 *  label?: {
 *      text: string;
 *      position?: 'left' | 'right'
 *  };
 *  id?: string;
 * }} props
 * @returns
 */
const Toggle = ({
  status,
  onChange,
  disabled,
  className,
  label,
  id = toggleId
}) => (
  <div className={classNames(styles.wrapper, className)}>
    {label && label.position && label.position === 'left' && (
      <div
        className={classNames(styles.label, disabled && styles.disabledLabel)}
      >
        {label.text}
      </div>
    )}
    <div className={styles.toggleContainer}>
      <input
        hidden
        id={id}
        onChange={() => onChange(!status)}
        disabled={disabled}
        type={'checkbox'}
        checked={status}
      />
      <label
        htmlFor={id}
        className={classNames(
          styles.toggle,
          status ? styles.activeToggle : styles.inactiveToggle,
          disabled && status && styles.disabledActiveToggle,
          disabled && !status && styles.disabledInactiveToggle
        )}
      >
        <span className={styles.switcher} />
      </label>
    </div>
    {label && label.position && label.position === 'right' && (
      <div
        className={classNames(styles.label, disabled && styles.disabledLabel)}
      >
        {label.text}
      </div>
    )}
  </div>
);

Toggle.propTypes = {
  status: bool.isRequired,
  onChange: func.isRequired,
  disabled: bool,
  className: string,
  label: shape({
    text: string.isRequired,
    position: 'left' || 'right'
  }),
  id: string
};

export { Toggle };
