import classNames from 'classnames';
import { arrayOf, bool, func, shape, string } from 'prop-types';
import styles from './Tabs.module.scss';
import { Hint } from './components';

/**
 * Tabs component.
 *
 * @author Oleksii Medvediev
 * @category Components.
 * @param {{
 *  tabs?: {
 *    isSelected: boolean;
 *    onClick: (value: string) => void;
 *    label: string;
 *    value: string;
 *    hint?: string;
 *    disabled?: boolean
 *  };
 *  selectedTabClassName: string;
 * }} props
 */
const Tabs = ({ tabs, selectedTabClassName, className }) => (
  <div id={'tabsWrapper'} className={classNames(styles.wrapper, className)}>
    {!!tabs?.length &&
      tabs.map(({ label, value, onClick, isSelected, hint, disabled }) => (
        <button
          className={classNames(
            styles.inactiveTab,
            isSelected && (selectedTabClassName ?? styles.activeTab),
            disabled && styles.disabled
          )}
          type={'button'}
          // tabIndex={disabled ? -1 : 0}
          onClick={!disabled && onClick}
          key={value}
        >
          {label}
          {hint && <Hint hint={hint} tab={value} />}
        </button>
      ))}
  </div>
);

Tabs.propTypes = {
  tabs: arrayOf(
    shape({
      isSelected: bool.isRequired,
      onClick: func.isRequired,
      label: string.isRequired,
      value: string.isRequired,
      hint: string
    })
  ),
  selectedTabClassName: string
};

export { Tabs };
