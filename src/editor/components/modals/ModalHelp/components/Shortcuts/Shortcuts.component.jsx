import { Component } from 'react';
import styles from './Shortcuts.module.scss';
import { DocumentationButton } from '../DocumentationButton';

const shortcuts = [
  [
    { key: ['w'], description: 'Translate' },
    { key: ['e'], description: 'Rotate' },
    { key: ['r'], description: 'Scale' },
    { key: ['d'], description: 'Duplicate selected entity' },
    { key: ['f'], description: 'Focus on selected entity' },
    { key: ['g'], description: 'Toggle grid visibility' },
    { key: ['n'], description: 'Add new entity' },
    { key: ['o'], description: 'Toggle local between global transform' },
    { key: ['del | backspace'], description: 'Delete selected entity' }
  ],
  [
    { key: ['0'], description: 'Toggle panels' },
    { key: ['1'], description: 'Perspective view' },
    { key: ['2'], description: 'Left view' },
    { key: ['3'], description: 'Right view' },
    { key: ['4'], description: 'Top view' },
    { key: ['5'], description: 'Bottom view' },
    { key: ['6'], description: 'Back view' },
    { key: ['7'], description: 'Front view' },

    { key: ['ctrl | cmd', 'x'], description: 'Cut selected entity' },
    { key: ['ctrl | cmd', 'c'], description: 'Copy selected entity' },
    { key: ['ctrl | cmd', 'v'], description: 'Paste entity' },
    { key: ['h'], description: 'Show this help' },
    { key: ['Esc'], description: 'Unselect entity' },
    { key: ['ctrl', 'alt', 'i'], description: 'Switch Edit and VR Modes' }
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
