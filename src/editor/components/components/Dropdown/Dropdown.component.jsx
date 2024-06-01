import { ArrowDown24Icon, ArrowUp24Icon } from '../../../icons';
import { arrayOf, bool, func, node, shape, string } from 'prop-types';
import { useRef, useState } from 'react';

import classNames from 'classnames';
import styles from './Dropdown.module.scss';
import { useClickOutside } from '../../../hooks';

/**
 * Dropdown component.
 *
 * @author Oleksii Medvediev
 * @category Components
 * @param {{
 *  options: Array<{value: string, label: string, disabled?: boolean}>;
 *  selectedOptionValue?: string;
 *  onSelect: (value: string) => void;
 *  label?: string;
 *  icon?: Element;
 *  placeholder: string;
 *  disabled?: boolean;
 * }} props
 */
const Dropdown = ({
  options,
  selectedOptionValue,
  onSelect,
  label,
  icon,
  placeholder,
  disabled,
  smallDropdown,
  className
}) => {
  const [isOptionsMenuOpen, setIsMenuOptionsOpen] = useState(false);
  const toggleOptionsMenu = () =>
    setIsMenuOptionsOpen((prevState) => !prevState);

  const findSelectedOptionLabel = () =>
    options.find(({ value }) => value === selectedOptionValue)?.label;

  const ref = useRef(null);

  useClickOutside(ref, () => setIsMenuOptionsOpen(false));

  return (
    <div className={classNames(styles.wrapper, className)}>
      {label && (
        <span
          className={classNames(styles.label, disabled && styles.disabledLabel)}
        >
          {label}
        </span>
      )}
      <div className={styles.dropdown} ref={ref}>
        <button
          type={'button'}
          tabIndex={0}
          disabled={disabled}
          onClick={toggleOptionsMenu}
          className={classNames(
            styles.selector,
            isOptionsMenuOpen && styles.selectorWithOpenedMenu,
            smallDropdown && styles.selectorOfSmallDropdown
          )}
        >
          {icon && <div className={styles.icon}>{icon}</div>}
          <span
            className={classNames(
              styles.selectedOptionLabel,
              smallDropdown && styles.selectedOptionLabelOfSmallDropdown
            )}
          >
            {findSelectedOptionLabel() ?? placeholder}
          </span>
          {isOptionsMenuOpen ? <ArrowUp24Icon /> : <ArrowDown24Icon />}
        </button>
        {isOptionsMenuOpen && (
          <div className={styles.optionsMenu}>
            {!!options.length &&
              options
                .sort((a, b) => {
                  if ((a.disabled ?? false) > (b.disabled ?? false)) {
                    return 1;
                  } else if ((a.disabled ?? false) < (b.disabled ?? false)) {
                    return -1;
                  } else {
                    return 0;
                  }
                })
                .map(({ value, label, disabled, onClick }, index) => (
                  <button
                    type={'button'}
                    tabIndex={0}
                    onClick={() => {
                      onSelect(value);
                      onClick();
                      toggleOptionsMenu();
                    }}
                    className={classNames(
                      styles.optionItem,
                      selectedOptionValue === value && styles.selectedItem
                    )}
                    key={value.concat(index.toString())}
                    disabled={disabled}
                  >
                    <span className={styles.optionItemLabel}>{label}</span>
                  </button>
                ))}
          </div>
        )}
      </div>
    </div>
  );
};

Dropdown.propTypes = {
  options: arrayOf(
    shape({
      value: string.isRequired,
      label: string.isRequired,
      disabled: bool
    })
  ).isRequired,
  selectedOptionValue: string,
  onSelect: func.isRequired,
  label: string,
  icon: node,
  placeholder: string.isRequired,
  disabled: bool
};

export { Dropdown };
