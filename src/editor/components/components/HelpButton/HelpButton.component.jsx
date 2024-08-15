import styles from './HelpButton.module.scss';

import { Button } from '../Button';
import { Component } from 'react';
import { QuestionMark } from './icons.jsx';

/**
 * HelpButton component.
 *
 * @author Anna Botsula, Oleksii Medvediev
 * @category Components.
 */
class HelpButton extends Component {
  render() {
    const onClick = () => {
      window.open('https://www.3dstreet.org/docs/', '_blank');
    };

    return (
      <div className={styles.wrapper}>
        <Button
          className={styles.helpButton}
          type="button"
          onClick={onClick}
          key="helpButton"
          variant={'toolbtn'}
        >
          {QuestionMark}
        </Button>
      </div>
    );
  }
}

export { HelpButton };
