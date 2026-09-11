import PropTypes from 'prop-types';
import { FormattedMessage } from 'react-intl';
import Component from './Component';
import DEFAULT_COMPONENTS from './DefaultComponents';
import { isGeneratorComponent } from '../../lib/featuredComponents';

// The raw component list behind every panel's "Advanced" pill (#1982). The
// parent owns the toggle (PanelFooter, or the segment / managed-street
// footers); this renders the explainer + warning and the component sections.
const AdvancedComponents = ({ entity }) => {
  const components = entity ? entity.components : {};
  const definedComponents = Object.keys(components).filter((key) => {
    // Skip default transform components and generator components (fully shown in
    // the featured section). geometry/material are intentionally kept here too,
    // so a technical user editing their first-class controls can still reach the
    // full set of advanced geometry/material settings.
    return DEFAULT_COMPONENTS.indexOf(key) === -1 && !isGeneratorComponent(key);
  });

  return (
    <div className="advanced-components">
      <div className="advanced-warning">
        <p>
          ⚠️{' '}
          <FormattedMessage
            id="advancedComponents.warning"
            defaultMessage="Warning: editing raw component data may cause unexpected scene damage that you cannot undo. Save a copy of your scene if you want to tinker with these at your own risk."
          />
        </p>
      </div>
      {definedComponents.sort().map((key) => (
        <div key={key} className={'details'}>
          <Component
            isCollapsed={definedComponents.length > 2}
            component={components[key]}
            entity={entity}
            name={key}
          />
        </div>
      ))}
    </div>
  );
};

AdvancedComponents.propTypes = {
  entity: PropTypes.object
};

export default AdvancedComponents;
