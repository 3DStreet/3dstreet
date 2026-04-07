import { useState, useEffect, useCallback } from 'react';
import { Button } from '../elements';
import ColorWidget from './ColorWidget';

export const getMaterials = (object3D) => {
  const materials = new Set();
  object3D.traverse((c) => c.material && materials.add(c.material));
  return Array.from(materials);
};

const CustomColorRow = ({ material, color, setMaterialColor }) => {
  return (
    <div className="propertyRow">
      <label className="text">{material}</label>
      <ColorWidget
        componentname="color"
        name="color"
        value={color}
        onChange={(_, v) => {
          setMaterialColor(material, v);
        }}
      />
    </div>
  );
};

const CustomizeColorContent = ({ materials, entity }) => {
  const [colorMapping, setColorMapping] = useState(
    entity.getAttribute('custom-colors') ?? {}
  );
  const setMaterialColor = (material, color) => {
    const newColorMapping = { ...colorMapping, [material]: color };
    if (color === undefined) delete newColorMapping[material];
    setColorMapping(newColorMapping);
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: entity,
      component: 'custom-colors',
      value: newColorMapping
    });
  };

  return (
    <div className="details">
      {materials.map((material) => (
        <CustomColorRow
          key={material.name}
          material={material.name}
          color={colorMapping[material.name] ?? ''}
          setMaterialColor={setMaterialColor}
        />
      ))}
    </div>
  );
};

const CustomizeColorWidget = ({ entity }) => {
  const [hasCustomColorComponent, setHasCustomColorComponent] = useState(
    Boolean(entity.getAttribute('custom-colors'))
  );

  const toggleCustomColors = () => {
    if (!hasCustomColorComponent) {
      AFRAME.INSPECTOR.execute('componentadd', {
        entity,
        component: 'custom-colors',
        value: ''
      });
      setHasCustomColorComponent(true);
      return;
    }
    AFRAME.INSPECTOR.execute('componentremove', {
      entity,
      component: 'custom-colors'
    });
    setHasCustomColorComponent(false);
  };

  const [materials, setMaterials] = useState([]);

  const updateMaterials = useCallback(() => {
    // Save the original material color values
    const newMaterials = getMaterials(entity.object3D);
    setMaterials(newMaterials);
  }, [entity.object3D]);

  // We need to dynamically get the materials from the mesh in case the
  // model is not loaded when the pane is loaded
  useEffect(() => {
    entity.addEventListener('object3dset', updateMaterials);
    if (entity.getObject3D('mesh')) {
      updateMaterials();
    } else {
      entity.addEventListener('model-loaded', updateMaterials, {
        once: true
      });
    }
    return () => {
      entity.removeEventListener('object3dset', updateMaterials);
    };
  }, [updateMaterials, entity.id, entity]);

  // No materials to customize, don't add the widget
  if (materials.length === 0) {
    return <></>;
  }

  return (
    <div className="details">
      <div className="propertyRow">
        <label className="text">Custom Colors</label>
        <Button variant="toolbtn" onClick={toggleCustomColors}>
          {hasCustomColorComponent ? 'Remove' : 'Add'}
        </Button>
      </div>
      {hasCustomColorComponent && (
        <CustomizeColorContent
          materials={materials}
          entity={entity}
          key={entity.object3D}
        />
      )}
    </div>
  );
};

export default CustomizeColorWidget;
