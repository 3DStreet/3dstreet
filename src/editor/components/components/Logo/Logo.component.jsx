import { Button } from '../Button';
import styles from './Logo.module.scss';
import useStore from '@/store';
/**
 * Logo component.
 *
 * @author Oleksii Medvediev
 * @category Components
 */
const Logo = () => {
  const setIsInspectorEnabled = useStore(
    (state) => state.setIsInspectorEnabled
  );
  const isInspectorEnabled = useStore((state) => state.isInspectorEnabled);

  return (
    <div className="flex items-center space-x-2">
      <div className={styles.logo} id="logoImg">
        <img src="ui_assets/3D-St-stacked-128.png" alt="3DStreet Logo" />
      </div>

      {!isInspectorEnabled && (
        <Button
          onClick={() => setIsInspectorEnabled(!isInspectorEnabled)}
          className={styles.btn}
          variant="toolbtn"
        >
          {isInspectorEnabled ? 'Enter Viewer mode' : 'Enter Editor mode'}
        </Button>
      )}
    </div>
  );
};

export { Logo };
