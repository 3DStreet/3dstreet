import styles from './ModalHelp.module.scss';

import { EssentialActions, Shortcuts } from './components/index.js';
import { Component } from 'react';

import Modal from '../Modal.jsx';
import PropTypes from 'prop-types';
import { FormattedMessage } from 'react-intl';
import { Tabs } from '../../elements';
import { commonMessages } from '@/editor/i18n/commonMessages';

const tabs = [
  {
    label: (
      <FormattedMessage
        id="help.tab.essentialActions"
        defaultMessage="Essential Actions"
      />
    ),
    value: 'essentialActions'
  },
  {
    label: <FormattedMessage {...commonMessages.keyboardShortcuts} />,
    value: 'shortcuts'
  }
];

class ModalHelp extends Component {
  static propTypes = {
    isOpen: PropTypes.bool,
    onClose: PropTypes.func.isRequired
  };

  state = {
    selectedTab: 'essentialActions'
  };

  handleChangeTab = (tab) =>
    this.setState((prevState) => ({
      ...prevState,
      selectedTab: tab
    }));

  render() {
    const { isOpen, onClose } = this.props;

    return (
      <Modal
        className={styles.helpModalWrapper}
        titleElement={
          <Tabs
            tabs={tabs.map((tab) => ({
              ...tab,
              isSelected: this.state.selectedTab === tab.value,
              onClick: () => this.handleChangeTab(tab.value)
            }))}
            selectedTabClassName={'selectedTab'}
          />
        }
        isOpen={isOpen}
        onClose={onClose}
        extraCloseKeyCode={72}
      >
        {this.state.selectedTab === 'shortcuts' ? (
          <Shortcuts />
        ) : (
          <EssentialActions />
        )}
      </Modal>
    );
  }
}

export { ModalHelp };
