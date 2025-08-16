import { bool, func, string } from 'prop-types';

import classNames from 'classnames';
import styles from './Checkbox.module.scss';
import { v4 } from 'uuid';

const checkboxId = v4();

/**
 * Checkbox component.
 *
 * @author Oleksii Medvediev
 * @category Components
 * @param {{
 *  isChecked: boolean;
 *  onChange: (value: boolean) => void;
 *  label?: string;
 *  className?: string;
 *  id?: string;
 *  disabled?: boolean
 * }} props
 */
const Checkbox = ({
  isChecked,
  onChange,
  label,
  className,
  id = checkboxId,
  disabled
}) => {
  return (
    <div className={classNames(styles.wrapper, className)}>
      <div className={styles.checkboxContainer}>
        <input
          hidden
          id={id}
          onChange={() => onChange(!isChecked)}
          checked={isChecked}
          type={'checkbox'}
          disabled={disabled}
        />
        <label
          htmlFor={id}
          className={classNames(
            styles.checkbox,
            disabled && styles.disabledCheckbox
          )}
        >
          <svg
            className={classNames(
              isChecked ? styles.checkedIcon : styles.uncheckedIcon
            )}
            width="8"
            height="7"
            viewBox="0 0 8 7"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1.25 3.5L3.08333 5.33333L7.08333 1.33333"
              stroke="#DBDBDB"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </label>
      </div>
      {label && (
        <label
          className={classNames(styles.label, disabled && styles.disabledLabel)}
          htmlFor={id}
        >
          {label}
        </label>
      )}
    </div>
  );
};

Checkbox.propTypes = {
  isChecked: bool.isRequired,
  onChange: func.isRequired,
  label: string,
  className: string,
  id: string,
  disabled: bool
};

export { Checkbox };
