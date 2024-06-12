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
        <div className={styles.wrapper} id="findme">
          <button type="button" onClick={handleSelectClick} key="handButton">
            <ArrowDown24Icon />
          </button>
          <button type="button" onClick={handleHandClick} key="handButton">
            <ArrowDown24Icon />
          </button>
          <button type="button" onClick={handleAddClick} key="addLayerButton">
            <Circle20Icon />
          </button>
        </div>
      )}
    </div>
  );
};

export { ActionBar };
