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
      window.open(
        'https://www.3dstreet.org/docs/3dstreet-editor/mouse-and-touch-controls',
        '_blank'
      );
    };

    return (
      <div className={styles.wrapper}>
        <Button onClick={onClick} variant="toolbtn">
          {QuestionMark}
        </Button>
      </div>
    );
  }
}

export { HelpButton };
