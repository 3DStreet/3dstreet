import { Circle20Icon, ArrowDown24Icon } from '../../../icons';
import Events from '../../../lib/Events';

import styles from './ActionBar.module.scss';

const ActionBar = ({ handleAddClick, isAddLayerPanelOpen }) => {
  const handleHandClick = () => {
    Events.emit('hidecursor');
  };

  const handleSelectClick = () => {
    Events.emit('showcursor');
  };

  return (
    <div>
      {!isAddLayerPanelOpen && (
        <div className={styles.wrapper}>
          <button type="button" onClick={handleSelectClick}>
            <ArrowDown24Icon />
          </button>
          <button type="button" onClick={handleHandClick}>
            <ArrowDown24Icon />
          </button>
          <button type="button" onClick={handleAddClick}>
            <Circle20Icon />
          </button>
        </div>
      )}
    </div>
  );
};

export { ActionBar };
