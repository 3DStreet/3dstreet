import React from 'react';
import styles from './AddLayerButton.module.scss';
import { Button } from '../Button';
import { Circle20Icon } from '../../../icons';

const AddLayerButton = ({ onClick }) => (
  <div className={styles.wrapper}>
    <Button
      className={styles.button}
      type="button"
      onClick={onClick}
      key="addLayerButton"
      variant={'custom'}
    >
      <Circle20Icon />
    </Button>
  </div>
);

export { AddLayerButton };
