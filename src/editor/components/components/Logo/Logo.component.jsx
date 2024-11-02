import { Button } from '../Button';
import PropTypes from 'prop-types';
import styles from './Logo.module.scss';

/**
 * Logo component.
 *
 * @author Oleksii Medvediev
 * @category Components
 */
const Logo = ({ onToggleEdit, isEditor }) => (
  <div className={styles.wrapper}>
    <div className={styles.logo} id="logoImg">
      <img src="ui_assets/3DSt-stacked-icon.png" alt="3DStreet Logo" />
    </div>
    <Button onClick={onToggleEdit} className={styles.btn} variant="toolbtn">
      {isEditor ? 'Enter Viewer mode' : 'Enter Editor mode'}
    </Button>
  </div>
);

Logo.propTypes = {
  onToggleEdit: PropTypes.func,
  isEditor: PropTypes.bool
};

export { Logo };
