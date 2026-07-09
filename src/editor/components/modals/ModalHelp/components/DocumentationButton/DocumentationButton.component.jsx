import styles from './DocumentationButton.module.scss';
import { Button } from '../../../../components';
import { Component } from 'react';
import { FormattedMessage } from 'react-intl';
import { Open } from './icons.jsx';
import { commonMessages } from '@/editor/i18n/commonMessages';
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
          <FormattedMessage {...commonMessages.documentation} /> <Open />
        </div>
      </Button>
    );
  }
}
export { DocumentationButton };
