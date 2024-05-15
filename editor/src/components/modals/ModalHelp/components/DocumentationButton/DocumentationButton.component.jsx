import styles from './DocumentationButton.module.scss';
import { Button } from '../../../../components';
import { Component } from 'react';
import { Open } from './icons.jsx';
/**
 * DocumentationButton component.
 * Exclusively for the EssentialsActions and Shortcuts components.
 *
 * @author Ihor Dubas
 * @category Components.
 */
class DocumentationButton extends Component {
  render() {
    return (
      <Button variant="toolbtn">
        <div
          className={styles.docsButtonWrapper}
          onClick={() => window.open('https://3dstreet.org/docs/')}
        >
          Documentation <Open />
        </div>
      </Button>
    );
  }
}
export { DocumentationButton };
