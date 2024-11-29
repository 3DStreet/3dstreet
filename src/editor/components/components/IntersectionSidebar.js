import { useState } from 'react';
import PropTypes from 'prop-types';
import SelectWidget from '../widgets/SelectWidget';
import NumberWidget from '../widgets/NumberWidget';
import BooleanWidget from '../widgets/BooleanWidget';

const IntersectionSidebar = ({ entity }) => {
  const intersectionData = entity.getAttribute('intersection');

  const [dimensionsArray, setDimensionsArray] = useState(
    intersectionData?.dimensions?.split(' ').map((num) => Number(num)) || []
  );
  // Initialize state for each array
  const [crosswalkArray, setCrosswalkArray] = useState(
    intersectionData?.crosswalk?.split(' ').map((num) => Number(num)) || []
  );
  const [sidewalkArray, setSidewalkArray] = useState(
    intersectionData?.sidewalk?.split(' ').map((num) => Number(num)) || []
  );
  const [stopsignArray, setStopsignArray] = useState(
    intersectionData?.stopsign?.split(' ').map((num) => Number(num)) || []
  );
  const [trafficsignalArray, setTrafficsignalArray] = useState(
    intersectionData?.trafficsignal?.split(' ').map((num) => Number(num)) || []
  );
  const [northeastcurbArray, setNortheastcurbArray] = useState(
    intersectionData?.northeastcurb?.split(' ').map((num) => Number(num)) || []
  );
  const [northwestcurbArray, setNorthwestcurbArray] = useState(
    intersectionData?.northwestcurb?.split(' ').map((num) => Number(num)) || []
  );
  const [southeastcurbArray, setSoutheastcurbArray] = useState(
    intersectionData?.southeastcurb?.split(' ').map((num) => Number(num)) || []
  );
  const [southwestcurbArray, setSouthwestcurbArray] = useState(
    intersectionData?.southwestcurb?.split(' ').map((num) => Number(num)) || []
  );

  const [curb, setCurb] = useState('northeast');
  const [index, setIndex] = useState(0);
  const options = ['West', 'East', 'North', 'South'];

  const curbArrays = {
    northeast: northeastcurbArray,
    northwest: northwestcurbArray,
    southeast: southeastcurbArray,
    southwest: southwestcurbArray
  };

  const handleCurbWidthChange = (name, value) => {
    const newCurbArray = [...curbArrays[curb]];
    newCurbArray[0] = value;
    updateCurbArray(newCurbArray);
  };

  const handleCurbHeightChange = (name, value) => {
    const newCurbArray = [...curbArrays[curb]];
    newCurbArray[1] = value;
    updateCurbArray(newCurbArray);
  };

  const updateCurbArray = (newCurbArray) => {
    switch (curb) {
      case 'northeast':
        setNortheastcurbArray(newCurbArray);
        break;
      case 'northwest':
        setNorthwestcurbArray(newCurbArray);
        break;
      case 'southeast':
        setSoutheastcurbArray(newCurbArray);
        break;
      case 'southwest':
        setSouthwestcurbArray(newCurbArray);
        break;
      default:
        break;
    }
    updateEntity('intersection', `${curb}curb`, newCurbArray.join(' '));
  };

  const updateEntity = (component, property, value) => {
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: entity,
      component: component,
      property: property,
      value: value
    });
  };
  return (
    <div className="intersection-sidebar mr-4">
      <div className="components">
        <div className="details">
          <div className="propertyRow">
            <div className="text">Width:</div>
            <NumberWidget
              name="dimensions"
              value={dimensionsArray[0]}
              onChange={(name, value) => {
                const newDimensionsArray = [...dimensionsArray];
                newDimensionsArray[0] = value;
                setDimensionsArray(newDimensionsArray);
                updateEntity(
                  'intersection',
                  'dimensions',
                  newDimensionsArray.join(' ')
                );
              }}
            />
          </div>
          <div className="propertyRow">
            <div className="text">Height:</div>
            <NumberWidget
              name="dimensions"
              value={dimensionsArray[1]}
              onChange={(name, value) => {
                const newDimensionsArray = [...dimensionsArray];
                newDimensionsArray[1] = value;
                setDimensionsArray(newDimensionsArray);
                updateEntity(
                  'intersection',
                  'dimensions',
                  newDimensionsArray.join(' ')
                );
              }}
            />
          </div>
          <div className="propertyRow">
            <div className="text">Approaches</div>
          </div>
          <div className="propertyRow">
            <label className="text">Direction:</label>
            <SelectWidget
              name="direction"
              value={options[index]}
              options={options}
              onChange={(name, value) => {
                setIndex(options.indexOf(value));
              }}
            />
          </div>
          <div className="propertyRow">
            <label className="text">Crosswalk:</label>
            <BooleanWidget
              name="crosswalk"
              componentname="crosswalk"
              value={crosswalkArray[index] === 1}
              onChange={(name, value) => {
                const newCrosswalkArray = [...crosswalkArray];
                newCrosswalkArray[index] = value ? 1 : 0;
                setCrosswalkArray(newCrosswalkArray);
                updateEntity(
                  'intersection',
                  'crosswalk',
                  newCrosswalkArray.join(' ')
                );
              }}
            />
          </div>
          <div className="propertyRow">
            <label className="text">Sidewalk:</label>
            <NumberWidget
              name="sidewalk"
              value={sidewalkArray[index]}
              onChange={(name, value) => {
                const newSidewalkArray = sidewalkArray.map((val, i) =>
                  i === index ? value : val
                );
                setSidewalkArray(newSidewalkArray);
                updateEntity(
                  'intersection',
                  'sidewalk',
                  newSidewalkArray.join(' ')
                );
              }}
            />
          </div>
          <div className="propertyRow">
            <label className="text">Traffic Control:</label>
            <SelectWidget
              name="trafficcontrol"
              options={['signal', 'stop', 'stop']}
              value={
                trafficsignalArray[index] === 1
                  ? 'signal'
                  : stopsignArray[index] === 1
                    ? 'stop'
                    : 'none'
              }
              onChange={(name, value) => {
                const newStopsignArray = [...stopsignArray];
                const newTrafficsignalArray = [...trafficsignalArray];

                // Reset both arrays at this index
                newStopsignArray[index] = 0;
                newTrafficsignalArray[index] = 0;

                // Set the appropriate array based on selection
                if (value === 'stop') {
                  newStopsignArray[index] = 1;
                } else if (value === 'signal') {
                  newTrafficsignalArray[index] = 1;
                }

                setStopsignArray(newStopsignArray);
                setTrafficsignalArray(newTrafficsignalArray);
                updateEntity(
                  'intersection',
                  'stopsign',
                  newStopsignArray.join(' ')
                );
                updateEntity(
                  'intersection',
                  'trafficsignal',
                  newTrafficsignalArray.join(' ')
                );
              }}
            ></SelectWidget>
          </div>
          <div className="propertyRow">
            <div className="text">Curbs</div>
          </div>
          <div className="propertyRow">
            <label className="text">Curb:</label>
            <SelectWidget
              name="curb"
              value={curb}
              options={['northeast', 'northwest', 'southeast', 'southwest']}
              onChange={(name, value) => {
                setCurb(value);
              }}
            />
          </div>
          <div className="propertyRow">
            <label className="text">Width:</label>
            <NumberWidget
              name="curbWidth"
              value={curbArrays[curb][0]}
              onChange={handleCurbWidthChange}
            />
          </div>
          <div className="propertyRow">
            <label className="text">Height:</label>
            <NumberWidget
              name="curbHeight"
              value={curbArrays[curb][1]}
              onChange={handleCurbHeightChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

IntersectionSidebar.propTypes = {
  entity: PropTypes.object
};

export default IntersectionSidebar;
