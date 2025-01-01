import { useMemo, useState } from 'react';
import { Button } from '../Button';
import BooleanWidget from '../../widgets/BooleanWidget';
import ColorWidget from '../../widgets/ColorWidget';
import SelectWidget from '../../widgets/SelectWidget';

export const getMaterials = (object3D) => {
  const materials = new Set();
  object3D.traverse((c) => c.material && materials.add(c.material));
  return Array.from(materials);
};

const CustomizeColorContent = ({ entity }) => {
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

  // Retrieve materials from the entity
  const materials = useMemo(() => getMaterials(entity.object3D), [entity]);
  const [selectedMaterial, setSelectedMaterial] = useState();

  const setMaterialColor = (material, color) => {
    const newColorMapping = { ...colorMapping, [material]: color };
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
      setMaterialColor(selectedMaterial, '#FF0000');
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

  return (
    <div className="details">
      <div className="propertyRow">
        <label className="text">Custom Colors</label>
        <Button variant="toolbtn" onClick={toggleCustomColors}>
          {hasCustomColorComponent ? 'Remove' : 'Add'} Custom Colors
        </Button>
      </div>
      {hasCustomColorComponent && <CustomizeColorContent entity={entity} />}
    </div>
  );
};

export default CustomizeColorWrapper;
