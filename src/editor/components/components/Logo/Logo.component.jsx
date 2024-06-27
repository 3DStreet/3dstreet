import { EditorLogo, ViewerLogo } from './logos.jsx';

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
      {isEditor ? <EditorLogo /> : <ViewerLogo />}
    </div>
    <Button onClick={onToggleEdit} className={styles.btn}>
      {isEditor ? 'Enter Viewer mode' : 'Enter Editor mode'}
    </Button>
  </div>
);

Logo.propTypes = {
  onToggleEdit: PropTypes.func,
  isEditor: PropTypes.bool
};

export { Logo };
