import { Component } from 'react';
import { FormattedMessage } from 'react-intl';
import styles from './Shortcuts.module.scss';
import { DocumentationButton } from '../DocumentationButton';

const shortcuts = [
  [
    {
      key: ['w'],
      description: (
        <FormattedMessage
          id="help.shortcut.translate"
          defaultMessage="Translate"
        />
      )
    },
    {
      key: ['e'],
      description: (
        <FormattedMessage id="help.shortcut.rotate" defaultMessage="Rotate" />
      )
    },
    {
      key: ['r'],
      description: (
        <FormattedMessage id="help.shortcut.scale" defaultMessage="Scale" />
      )
    },
    {
      key: ['d'],
      description: (
        <FormattedMessage
          id="help.shortcut.duplicate"
          defaultMessage="Duplicate selected entity"
        />
      )
    },
    {
      key: ['f'],
      description: (
        <FormattedMessage
          id="help.shortcut.focus"
          defaultMessage="Focus on selected entity"
        />
      )
    },
    {
      key: ['g'],
      description: (
        <FormattedMessage
          id="help.shortcut.toggleGrid"
          defaultMessage="Toggle grid visibility"
        />
      )
    },
    {
      key: ['n'],
      description: (
        <FormattedMessage
          id="help.shortcut.addEntity"
          defaultMessage="Add new entity"
        />
      )
    },
    {
      key: ['o'],
      description: (
        <FormattedMessage
          id="help.shortcut.toggleTransform"
          defaultMessage="Toggle local between global transform"
        />
      )
    },
    {
      key: ['delete | backspace'],
      description: (
        <FormattedMessage
          id="help.shortcut.delete"
          defaultMessage="Delete selected entity"
        />
      )
    },
    {
      key: ['ctrl | cmd', 'z'],
      description: (
        <FormattedMessage id="help.shortcut.undo" defaultMessage="Undo action" />
      )
    },
    {
      key: ['ctrl | cmd', 'shift', 'z'],
      description: (
        <FormattedMessage id="help.shortcut.redo" defaultMessage="Redo action" />
      )
    }
  ],
  [
    {
      key: ['`'],
      description: (
        <FormattedMessage
          id="help.shortcut.togglePanels"
          defaultMessage="Toggle panels"
        />
      )
    },
    {
      key: ['1'],
      description: (
        <FormattedMessage
          id="help.shortcut.perspectiveView"
          defaultMessage="Perspective view"
        />
      )
    },
    {
      key: ['2'],
      description: (
        <FormattedMessage
          id="help.shortcut.leftView"
          defaultMessage="Left view"
        />
      )
    },
    {
      key: ['3'],
      description: (
        <FormattedMessage
          id="help.shortcut.rightView"
          defaultMessage="Right view"
        />
      )
    },
    {
      key: ['4'],
      description: (
        <FormattedMessage id="help.shortcut.topView" defaultMessage="Top view" />
      )
    },
    {
      key: ['5'],
      description: (
        <FormattedMessage
          id="help.shortcut.bottomView"
          defaultMessage="Bottom view"
        />
      )
    },
    {
      key: ['6'],
      description: (
        <FormattedMessage
          id="help.shortcut.backView"
          defaultMessage="Back view"
        />
      )
    },
    {
      key: ['7'],
      description: (
        <FormattedMessage
          id="help.shortcut.frontView"
          defaultMessage="Front view"
        />
      )
    },

    {
      key: ['ctrl | cmd', 'c'],
      description: (
        <FormattedMessage
          id="help.shortcut.copy"
          defaultMessage="Copy selected entity"
        />
      )
    },
    {
      key: ['ctrl | cmd', 'v'],
      description: (
        <FormattedMessage
          id="help.shortcut.paste"
          defaultMessage="Paste entity"
        />
      )
    },
    {
      key: ['h'],
      description: (
        <FormattedMessage
          id="help.shortcut.showHelp"
          defaultMessage="Show this help"
        />
      )
    },
    {
      key: ['esc'],
      description: (
        <FormattedMessage
          id="help.shortcut.unselect"
          defaultMessage="Unselect entity"
        />
      )
    },
    {
      key: ['ctrl', 'alt', 'i'],
      description: (
        <FormattedMessage
          id="help.shortcut.switchVr"
          defaultMessage="Switch Edit and VR Modes"
        />
      )
    }
  ]
];

/**
 * Shortcuts component.
 * Exclusively for the ModalHelp component as a 'Shortcuts' tab content.
 *
 * @author Oleksii Medvediev
 * @category Components.
 */
class Shortcuts extends Component {
  render() {
    return (
      <div className={styles.helpLists}>
        {shortcuts.map((column, idx) => (
          <ul className={styles.helpList} key={idx}>
            {column.map(({ description, key }) => (
              <li key={key} className={styles.helpKeyUnit}>
                {key.map((item) => (
                  <kbd key={item} className={styles.helpKey}>
                    <span>{item}</span>
                  </kbd>
                ))}
                <span className={styles.helpKeyDef}>{description}</span>
              </li>
            ))}
          </ul>
        ))}
        <DocumentationButton />
      </div>
    );
  }
}

export { Shortcuts };
