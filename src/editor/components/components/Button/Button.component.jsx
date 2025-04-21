import { bool, element, func, node, number, object, string } from 'prop-types';
import { useState, useCallback } from 'react';

import classNames from 'classnames';
import styles from './Button.module.scss';

const variants = {
  filled: styles.filledButton,
  outlined: styles.outlinedButton,
  ghost: styles.ghostButton,
  toolbtn: styles.toolButton,
  white: styles.whiteButton,
  custom: styles.customButton,
  save: styles.saveButton
};

/**
 * Button component.
 *
 * @author Oleksii Medvediev
 * @category Components
 * @param {{
 *  className?: string;
 *  style?: object;
 *  onClick?: () => void;
 *  onPointerDown?: () => void;
 *  onPointerUp?: () => void;
 *  onPointerLeave?: () => void;
 *  type?: string;
 *  children?: Node;
 *  variant?: string;
 *  disabled?: boolean;
 *  id?: string | number;
 *  leadingIcon?: Element;
 *  trailingIcon?: Element;
 *  onLongPress: func,
 *  longPressDelay: number, // Duration in ms
 * }} props
 */
const Button = ({
  className,
  style,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  type = 'button',
  children,
  variant = 'filled',
  disabled,
  id,
  leadingIcon,
  trailingIcon,
  onLongPress,
  longPressDelay = 2000, // Default 2 seconds
  title
}) => {
  const [pressTimer, setPressTimer] = useState(null);
  const [isPressing, setIsPressing] = useState(false);

  const startPressTimer = useCallback(() => {
    if (!onLongPress) return; // Only start timer if onLongPress exists
    setIsPressing(true);
    const timer = setTimeout(() => {
      if (onLongPress) {
        onLongPress();
      }
      setIsPressing(false);
    }, longPressDelay);
    setPressTimer(timer);
  }, [onLongPress, longPressDelay]);

  const clearPressTimer = useCallback(() => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      setPressTimer(null);
      setIsPressing(false);
    }
  }, [pressTimer]);
  return (
    <button
      className={classNames(styles.buttonWrapper, variants[variant], className)}
      style={{ ...style, position: 'relative' }}
      onClick={onClick}
      onPointerDown={(e) => {
        startPressTimer();
        onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        clearPressTimer();
        onPointerUp?.(e);
      }}
      onPointerLeave={(e) => {
        clearPressTimer();
        onPointerLeave?.(e);
      }}
      type={type}
      tabIndex={0}
      disabled={disabled}
      id={id}
      title={title}
    >
      {leadingIcon && <div className={styles.icon}>{leadingIcon}</div>}
      {children}
      {trailingIcon && <div className={styles.icon}>{trailingIcon}</div>}

      {onLongPress && (
        <div
          className={classNames(styles.pressProgress, {
            [styles.pressing]: isPressing
          })}
          style={{
            '--press-duration': `${longPressDelay}ms`
          }}
        />
      )}
    </button>
  );
};

Button.propTypes = {
  className: string,
  style: object,
  onClick: func,
  onPointerDown: func,
  onPointerUp: func,
  onPointerLeave: func,
  type: string,
  children: node,
  variant: string,
  disabled: bool,
  id: string || number,
  leadingIcon: element,
  trailingIcon: element,
  title: string,
  onLongPress: func,
  longPressDelay: number
};

export { Button };
