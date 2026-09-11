import { useState } from 'react';
import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import AddGeneratorComponent from './AddGeneratorComponent';
import AdvancedComponents from './AdvancedComponents';

/**
 * Compact properties-panel footer (#1982), same design as the street-segment
 * panel's: the Add Component select (when the entity has approved add-ons)
 * next to an Advanced pill that reveals the raw component list below.
 */
const PanelFooter = ({ entity, addComponents }) => {
  const intl = useIntl();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const toggleAdvanced = () => {
    posthog.capture('toggleAdvanced', { showAdvanced });
    setShowAdvanced((v) => !v);
  };

  return (
    <>
      <div className="panel-footer">
        {addComponents?.length > 0 && (
          <AddGeneratorComponent entity={entity} components={addComponents} />
        )}
        <button
          type="button"
          className={'advanced-btn' + (showAdvanced ? ' is-open' : '')}
          onClick={toggleAdvanced}
        >
          {intl.formatMessage({
            id: 'segmentSidebar.advanced',
            defaultMessage: 'Advanced'
          })}
        </button>
      </div>
      {showAdvanced && (
        <div className="advancedComponentsContainer">
          <AdvancedComponents entity={entity} />
        </div>
      )}
    </>
  );
};

PanelFooter.propTypes = {
  entity: PropTypes.object.isRequired,
  // Approved add-on components ([{ value, label, attrValue? }]); omit or pass
  // [] to render the Advanced pill alone.
  addComponents: PropTypes.array
};

export default PanelFooter;
