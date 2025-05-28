import { bool, func, node, string } from 'prop-types';

import classnames from 'classnames';
import styles from './Input.module.scss';
import { useRef } from 'react';
import { v4 } from 'uuid';

const id = v4();

/**
 * Input component.
 *
 * @author Oleksii Medvediev
 * @category Components
 * @param {{
 *  className?: string;
 *  type?: string;
 *  onChange: (value: string) => void;
 *  leadingIcon?: Element;
 *  leadingSubtext?: string;
 *  tailingIcon?: Element;
 *  tailingSubtext?: string;
 *  label?: string;
 *  inputId?: string;
 *  placeholder?: string;
 *  errorMessage?: string;
 *  successMessage?: string;
 *  disabled?: boolean;
 *  readOnly?: boolean;
 *  hideBorderAndBackground?: boolean;
 * }} props
 */
const Input = ({
  className,
  type = 'text',
  onChange,
  leadingIcon,
  tailingIcon,
  leadingSubtext,
  tailingSubtext,
  label,
  inputId = id,
  placeholder,
  errorMessage,
  successMessage,
  defaultValue,
  disabled,
  readOnly,
  hideBorderAndBackground,
  value
}) => {
  const inputElement = useRef(null);
  const hideBorderAndBackgroundStyles = {
    border: 'none',
    background: 'none',
    padding: '0px',
    width: 'calc(100% - 12px)'
  };
  return (
    <div className={classnames(styles.wrapper, className)}>
      {label && (
        <label
          htmlFor={inputId}
          className={classnames(styles.label, disabled && styles.disabledLabel)}
        >
          {label}
        </label>
      )}
      <div
        role={'button'}
        tabIndex={0}
        onClick={() => {
          inputElement.current.focus();
        }}
        className={classnames(
          styles.inputElementContainer,
          disabled && styles.disabledInputContainer,
          errorMessage &&
            !successMessage &&
            !disabled &&
            styles.erroredInputContainer,
          successMessage &&
            !errorMessage &&
            !disabled &&
            styles.successInputContainer
        )}
        style={hideBorderAndBackground && hideBorderAndBackgroundStyles}
      >
        {leadingIcon && (
          <div className={styles.iconContainer}>{leadingIcon}</div>
        )}
        {leadingSubtext && (
          <span className={styles.subtext}>{leadingSubtext}</span>
        )}
        <input
          ref={inputElement}
          type={type === 'number' ? 'number' : type}
          onChange={(event) => onChange(event.currentTarget.value)}
          id={inputId}
          placeholder={placeholder}
          className={styles.inputElement}
          disabled={disabled}
          defaultValue={defaultValue}
          value={value}
          readOnly={readOnly}
        />
        {tailingSubtext && (
          <span className={styles.subtext}>{tailingSubtext}</span>
        )}
        {tailingIcon && (
          <div className={styles.iconContainer}>{tailingIcon}</div>
        )}
      </div>
      {errorMessage && !successMessage && !disabled && (
        <span className={styles.errorMessage}>{errorMessage}</span>
      )}
      {successMessage && !errorMessage && !disabled && (
        <span className={styles.successMessage}>{successMessage}</span>
      )}
    </div>
  );
};

Input.propTypes = {
  className: string,
  type: string,
  onChange: func,
  leadingIcon: node,
  tailingIcon: node,
  leadingSubtext: string,
  tailingSubtext: string,
  label: string,
  inputId: string,
  placeholder: string,
  errorMessage: string,
  successMessage: string,
  disabled: bool,
  readOnly: bool,
  hideBorderAndBackground: bool
};

export { Input };
