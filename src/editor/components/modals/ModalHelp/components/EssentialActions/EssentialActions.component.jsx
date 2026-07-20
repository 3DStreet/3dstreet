import styles from './EssentialActions.module.scss';

import {
  Angle,
  Drag,
  Edit,
  RButton,
  Scroll,
  View,
  ZoomIn,
  ZoomOut
} from './icons.jsx';
import { Component } from 'react';
import { FormattedMessage } from 'react-intl';
import { DocumentationButton } from '../DocumentationButton';

const actions = [
  {
    id: 'moveMap',
    title: (
      <FormattedMessage
        id="help.action.moveMap.title"
        defaultMessage="Move the map by dragging"
      />
    ),
    description: (
      <FormattedMessage
        id="help.action.moveMap.description"
        defaultMessage="Click and drag to pan the map view."
      />
    ),
    items: [[Angle, Drag]]
  },
  {
    id: 'zoomMap',
    title: (
      <FormattedMessage
        id="help.action.zoomMap.title"
        defaultMessage="Zoom the map by scrolling"
      />
    ),
    description: (
      <FormattedMessage
        id="help.action.zoomMap.description"
        defaultMessage="Use the mouse scrollwheel (or touchpad scrolling motion) to zoom in and out."
      />
    ),
    items: [
      [
        Scroll,
        <FormattedMessage key="or" id="help.action.or" defaultMessage="or" />,
        ZoomOut,
        ZoomIn
      ]
    ]
  },
  {
    id: 'rotateMap',
    title: (
      <FormattedMessage
        id="help.action.rotateMap.title"
        defaultMessage="Rotate the map by right-clicking and dragging"
      />
    ),
    description: (
      <FormattedMessage
        id="help.action.rotateMap.description"
        defaultMessage="Right-click and drag to rotate the map while staying in place."
      />
    ),
    items: [[RButton, Drag]]
  },
  {
    id: 'modeSwitch',
    title: (
      <FormattedMessage
        id="help.action.modeSwitch.title"
        defaultMessage="Mode switch"
      />
    ),
    description: (
      <FormattedMessage
        id="help.action.modeSwitch.description"
        defaultMessage={
          'To switch between the "View" and "Edit" modes, click the button in the upper right corner.'
        }
      />
    ),
    items: [[View, Edit]]
  }
];

/**
 * EssentialActions component.
 * Exclusively for the HelpModal component as an 'Essential Actions' tab content.
 *
 * @author Oleksii Medvediev
 * @category Components.
 */
class EssentialActions extends Component {
  render() {
    return (
      <div className={styles.essentialActionsWrapper}>
        {actions.map(({ id, title, description, items }) => (
          <div className={styles.action} key={id}>
            <div className={styles.text}>
              <h3 className={styles.actionTitle}>{title}</h3>
              <p className={styles.actionDescription}>{description}</p>
            </div>
            <div className={styles.icons}>
              {items.map((row, index) => (
                <div
                  className={styles.itemsRow}
                  key={id.concat(index.toString())}
                >
                  {row.map((item, index) => (
                    <span className={styles.item} key={index.toString()}>
                      {item}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
        <DocumentationButton />
      </div>
    );
  }
}

export { EssentialActions };
