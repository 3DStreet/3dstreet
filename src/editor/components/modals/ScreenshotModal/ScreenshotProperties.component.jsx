import PropTypes from 'prop-types';
import styles from './ScreenshotModal.module.scss';
import PropertyRow from '../../components/PropertyRow.js';

const ScreenshotProperties = ({ entity }) => {
  const componentName = 'screentock';
  const component = entity?.components?.[componentName];
  console.log(component);

  return (
    <div className={styles.propertiesPanel}>
      <div className={styles.propertiesHeader}>Screenshot Properties</div>
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
              isSingle={false}
              entity={entity}
            />
            <PropertyRow
              key="showTitle"
              name="showTitle"
              label="Show Title"
              schema={component.schema['showTitle']}
              data={component.data['showTitle']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
            <PropertyRow
              key="titleFont"
              name="titleFont"
              label="Title Font"
              schema={component.schema['titleFont']}
              data={component.data['titleFont']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
            <PropertyRow
              key="titleSize"
              name="titleSize"
              label="Title Size"
              schema={component.schema['titleSize']}
              data={component.data['titleSize']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
            <PropertyRow
              key="titleColor"
              name="titleColor"
              label="Title Color"
              schema={component.schema['titleColor']}
              data={component.data['titleColor']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
            <PropertyRow
              key="titleStroke"
              name="titleStroke"
              label="Title Stroke"
              schema={component.schema['titleStroke']}
              data={component.data['titleStroke']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
            <PropertyRow
              key="titleStrokeColor"
              name="titleStrokeColor"
              label="Stroke Color"
              schema={component.schema['titleStrokeColor']}
              data={component.data['titleStrokeColor']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
            <PropertyRow
              key="titleStrokeWidth"
              name="titleStrokeWidth"
              label="Stroke Width"
              schema={component.schema['titleStrokeWidth']}
              data={component.data['titleStrokeWidth']}
              componentname={componentName}
              isSingle={false}
              entity={entity}
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
