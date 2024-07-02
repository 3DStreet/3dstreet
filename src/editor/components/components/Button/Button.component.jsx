import { bool, element, func, node, number, string } from 'prop-types';

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
 *  onClick?: () => void;
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
  onClick,
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
    onClick={onClick}
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
  onClick: func,
  type: string,
  children: node,
  variant: string,
  disabled: bool,
  id: string || number,
  leadingIcon: element,
  trailingIcon: element
};

export { Button };
