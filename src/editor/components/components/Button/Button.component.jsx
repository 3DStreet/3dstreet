import { bool, element, func, node, number, object, string } from 'prop-types';

import classNames from 'classnames';
import styles from './Button.module.scss';

const variants = {
  filled: styles.filledButton,
  outlined: styles.outlinedButton,
  ghost: styles.ghostButton,
  toolbtn: styles.toolButton,
  white: styles.whiteButton,
  custom: styles.customButton
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
  trailingIcon
}) => (
  <button
    className={classNames(styles.buttonWrapper, variants[variant], className)}
    style={style}
    onClick={onClick}
    onPointerDown={onPointerDown}
    onPointerUp={onPointerUp}
    onPointerLeave={onPointerLeave}
    type={type}
    tabIndex={0}
    disabled={disabled}
    id={id}
  >
    {leadingIcon && <div className={styles.icon}>{leadingIcon}</div>}
    {children}
    {trailingIcon && <div className={styles.icon}>{trailingIcon}</div>}
  </button>
);

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
  trailingIcon: element
};

export { Button };
