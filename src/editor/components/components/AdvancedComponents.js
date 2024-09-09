import { useState } from 'react';
import PropTypes from 'prop-types';
import Component from './Component';
import DEFAULT_COMPONENTS from './DefaultComponents';
import { Button } from '../components';
import posthog from 'posthog-js';
const AdvancedComponents = ({ entity }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const components = entity ? entity.components : {};
  const definedComponents = Object.keys(components).filter((key) => {
    return DEFAULT_COMPONENTS.indexOf(key) === -1;
  });

  const toggleAdvanced = () => {
    posthog.capture('toggleAdvanced', { showAdvanced });
    setShowAdvanced(!showAdvanced);
  };

  return (
    <div className="advanced-components">
      <Button variant="toolbtn" onClick={toggleAdvanced}>
        {showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
      </Button>
      {showAdvanced &&
        definedComponents.sort().map((key) => (
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
