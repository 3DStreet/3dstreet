import { useMemo, useState, useEffect, useCallback } from 'react';
import { Button } from '../Button';
import BooleanWidget from '../../widgets/BooleanWidget';
import ColorWidget from '../../widgets/ColorWidget';
import SelectWidget from '../../widgets/SelectWidget';

export const getMaterials = (object3D) => {
  const materials = new Set();
  object3D.traverse((c) => c.material && materials.add(c.material));
  return Array.from(materials);
};

const CustomizeColorContent = ({ materials, entity }) => {
  const customColorData = entity.getAttribute('custom-colors') ?? '';
  // Convert the string data of `materialName:color;...` to a mapping of color overrides: { [materialName]: color }
  const baseColorMapping = useMemo(() => {
    if (!customColorData) return {};
    const mapping = {};
    customColorData
      .replaceAll(' ', '')
      .split(';')
      .forEach((entry) => {
        // Skip unnamed
        if (entry === '') return;
        const [mat, color] = entry.split(':');
        mapping[mat] = color;
      });
    return mapping;
  }, [customColorData]);
  const [colorMapping, setColorMapping] = useState(baseColorMapping);
  const [selectedMaterial, setSelectedMaterial] = useState();

  const setMaterialColor = (material, color) => {
    const newColorMapping = { ...colorMapping, [material]: color };
    if (color === undefined) delete newColorMapping[material];
    setColorMapping(newColorMapping);

    const newColorsString = Object.entries(newColorMapping)
      .map(([mat, color]) => `${mat}:${color}`)
      .join(';');

    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: entity,
      component: 'custom-colors',
      value: newColorsString
    });
  };

  const handleToggleOverride = (_, v) => {
    if (v) {
      setMaterialColor(selectedMaterial, '#FFFFFF');
    } else {
      setMaterialColor(selectedMaterial, undefined);
    }
  };

  const handleColorChange = (_, v) => {
    setMaterialColor(selectedMaterial, v);
  };

  return (
    <div className="details">
      <div className="propertyRow">
        <label className="text">Material</label>
        <SelectWidget
          name="material"
          value={selectedMaterial}
          onChange={(_, v) => {
            setSelectedMaterial(v);
          }}
          options={materials.map((m) => m.name)}
        />
      </div>
      {selectedMaterial && (
        <>
          <div className="propertyRow">
            <label className="text">Override default</label>
            <BooleanWidget
              componentname="override"
              name="override"
              onChange={handleToggleOverride}
              value={colorMapping[selectedMaterial] !== undefined}
            />
          </div>
          <div className="propertyRow">
            <label className="text">Color</label>
            <ColorWidget
              componentname="color"
              name="color"
              value={colorMapping[selectedMaterial]}
              onChange={handleColorChange}
            />
          </div>
        </>
      )}
    </div>
  );
};

const CustomizeColorWrapper = ({ entity }) => {
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
    newMaterials.forEach((material) => {
      material.userData.origColor = material.color.clone();
    });
    setMaterials(newMaterials);
  }, [entity.object3D]);

  // We need to dynamically get the materials from the mesh in case the
  // model is not loaded when the pane is loaded
  useEffect(() => {
    if (entity.getObject3D('mesh')) {
      updateMaterials();
    } else {
      entity.addEventListener('model-loaded', () => {
        updateMaterials();
      });
    }
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
          {hasCustomColorComponent ? 'Remove' : 'Add'} Custom Colors
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

export default CustomizeColorWrapper;