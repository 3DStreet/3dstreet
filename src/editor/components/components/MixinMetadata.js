import React from 'react';
import PropTypes from 'prop-types';
import Events from '../../lib/Events';
import catalog from '../../../catalog.json';
import { Open24Icon } from '../../icons';

export default class MixinMetadata extends React.Component {
  static propTypes = {
    entity: PropTypes.object.isRequired
  };

  constructor(props) {
    super(props);
    this.state = {
      metadata: this.getMetadataFromCatalog()
    };
  }

  componentDidMount() {
    Events.on('entityupdate', this.onEntityUpdate);
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
  }

  componentDidUpdate(prevProps) {
    if (this.props.entity !== prevProps.entity) {
      this.setState({ metadata: this.getMetadataFromCatalog() });
    }
  }

  onEntityUpdate = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    if (detail.component === 'mixin') {
      this.setState({ metadata: this.getMetadataFromCatalog() });
    }
  };

  getMetadataFromCatalog() {
    const mixinValue = (this.props.entity.getAttribute('mixin') || '').trim();
    if (!mixinValue) return null;

    // If there are multiple mixins, we don't show metadata
    if (mixinValue.includes(' ')) return null;

    // Find the catalog entry for this mixin
    const catalogEntry = catalog.find((entry) => entry.id === mixinValue);
    if (!catalogEntry) return null;

    return catalogEntry;
  }

  render() {
    const { metadata } = this.state;
    if (!metadata) return null;

    // Properties to exclude from automatic rendering
    const excludedProps = ['img', 'src', 'copyrightUrl'];

    // Create a function to generate a property row
    const createPropertyRow = (key, value) => {
      if (excludedProps.includes(key) || !value) return null;
      if (key === 'id') key = 'ID';

      // Special handling for copyright
      if (key === 'copyright') {
        return (
          <div className="propertyRow" key={key}>
            <div className="text">{key}</div>
            <div className="string">
              {metadata.copyrightUrl ? (
                <a
                  href={metadata.copyrightUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    textDecoration: 'dotted underline',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  {value} <Open24Icon />
                </a>
              ) : (
                value
              )}
            </div>
          </div>
        );
      }

      if (key === 'ID' || key === 'category') {
        return (
          <div className="propertyRow" key={key}>
            <div className="text">{key}</div>
            <div className="string" style={{ fontFamily: 'monospace' }}>
              `{value}`
            </div>
          </div>
        );
      }

      // Standard property row
      return (
        <div className="propertyRow" key={key}>
          <div className="text">{key}</div>
          <div className="string">{value}</div>
        </div>
      );
    };

    // Generate property rows in specific order
    const orderedKeys = ['name', 'id', 'category'];
    const propertyRows = [
      // First render the ordered keys if they exist
      ...orderedKeys
        .map((key) => createPropertyRow(key, metadata[key]))
        .filter(Boolean),
      // Then render all other keys
      ...Object.entries(metadata)
        .filter(
          ([key]) => !orderedKeys.includes(key) && !excludedProps.includes(key)
        )
        .map(([key, value]) => createPropertyRow(key, value))
        .filter(Boolean)
    ];

    return (
      <div className="mixin-metadata">
        <div className="collapsible component">
          <div className="static">
            <div className="componentHeader collapsible-header">
              <span className="componentTitle" title="Surface">
                <span>Model Info</span>
              </span>
            </div>
          </div>
          {propertyRows}
        </div>
      </div>
    );
  }
}
