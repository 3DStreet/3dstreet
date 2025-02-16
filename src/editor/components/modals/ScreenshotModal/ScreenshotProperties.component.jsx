import PropTypes from 'prop-types';
import styles from './ScreenshotModal.module.scss';
import PropertyRow from '../../components/PropertyRow.js';
import { makeScreenshot } from '@/editor/lib/SceneUtils.js';
import { debounce } from 'lodash-es';

const ScreenshotProperties = ({ entity }) => {
  const componentName = 'screentock';
  const component = entity?.components?.[componentName];

  const debouncedMakeScreenshot = debounce(() => {
    makeScreenshot(false);
  }, 500);

  return (
    <div className={styles.propertiesPanel}>
      <div className={styles.propertiesContent}>
        {component && component.schema && component.data && (
          <>
            <PropertyRow
              key="showLogo"
              name="showLogo"
              label="Show Logo"
              schema={component.schema['showLogo']}
              data={component.data['showLogo']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
            <PropertyRow
              key="showTitle"
              name="showTitle"
              label="Show Title"
              schema={component.schema['showTitle']}
              data={component.data['showTitle']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
            <PropertyRow
              key="titleFont"
              name="titleFont"
              label="Title Font"
              schema={component.schema['titleFont']}
              data={component.data['titleFont']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
            <PropertyRow
              key="titleSize"
              name="titleSize"
              label="Title Size"
              schema={component.schema['titleSize']}
              data={component.data['titleSize']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
            <PropertyRow
              key="titleColor"
              name="titleColor"
              label="Title Color"
              schema={component.schema['titleColor']}
              data={component.data['titleColor']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
            <PropertyRow
              key="titleStroke"
              name="titleStroke"
              label="Title Stroke"
              schema={component.schema['titleStroke']}
              data={component.data['titleStroke']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
            <PropertyRow
              key="titleStrokeColor"
              name="titleStrokeColor"
              label="Stroke Color"
              schema={component.schema['titleStrokeColor']}
              data={component.data['titleStrokeColor']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
            <PropertyRow
              key="titleStrokeWidth"
              name="titleStrokeWidth"
              label="Stroke Width"
              schema={component.schema['titleStrokeWidth']}
              data={component.data['titleStrokeWidth']}
              componentname={componentName}
              entity={entity}
              noSelectEntity={true}
              onEntityUpdate={() => debouncedMakeScreenshot()}
            />
          </>
        )}
      </div>
    </div>
  );
};

ScreenshotProperties.propTypes = {
  entity: PropTypes.object.isRequired
};

export { ScreenshotProperties };
