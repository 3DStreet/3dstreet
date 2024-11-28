import { useState } from 'react';
import PropTypes from 'prop-types';

const IntersectionSidebar = ({ entity }) => {
  console.log(entity);
  const intersectionData = entity.getAttribute('intersection');
  console.log(intersectionData);

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
  const [direction, setDirection] = useState('west');
  const index = ['west', 'east', 'north', 'south'].indexOf(direction);

  const curbArrays = {
    northeast: northeastcurbArray,
    northwest: northwestcurbArray,
    southeast: southeastcurbArray,
    southwest: southwestcurbArray
  };

  const handleCurbWidthChange = (e) => {
    const newWidth = Number(e.target.value);
    const newCurbArray = [...curbArrays[curb]];
    newCurbArray[0] = newWidth;
    updateCurbArray(newCurbArray);
  };

  const handleCurbHeightChange = (e) => {
    const newHeight = Number(e.target.value);
    const newCurbArray = [...curbArrays[curb]];
    newCurbArray[1] = newHeight;
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
    entity.setAttribute('intersection', {
      ...intersectionData,
      [`${curb}curb`]: newCurbArray.join(' ')
    });
  };

  return (
    <div className="intersection-sidebar">
      <h3>Intersection Settings</h3>
      <div className="intersection-controls">
        <div>Approaches</div>
        <div className="direction-selector mb-2">
          <label>Direction:</label>
          <select
            onChange={(e) => {
              const newDirection = e.target.value;
              setDirection(newDirection);
            }}
            defaultValue="west"
          >
            {['west', 'east', 'north', 'south'].map((direction) => (
              <option key={direction} value={direction}>
                {direction.charAt(0).toUpperCase() + direction.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="intersection-section">
          <h4 className="capitalize">{direction}</h4>
          <div className="section-controls">
            <div className="control-row">
              <label>Crosswalk:</label>
              <input
                type="checkbox"
                checked={crosswalkArray[index] === 1}
                onChange={(e) => {
                  const newCrosswalkArray = [...crosswalkArray];
                  newCrosswalkArray[index] = e.target.checked ? 1 : 0;
                  setCrosswalkArray(newCrosswalkArray);
                  entity.setAttribute('intersection', {
                    ...intersectionData,
                    crosswalk: newCrosswalkArray.join(' ')
                  });
                }}
              />
            </div>
            <div className="control-row">
              <label>Sidewalk:</label>
              <input
                type="number"
                value={sidewalkArray[index]}
                onChange={(e) => {
                  const newValue = e.target.value;
                  setSidewalkArray(
                    sidewalkArray.map((val, i) =>
                      i === index ? Number(newValue) : val
                    )
                  );
                  entity.setAttribute('intersection', {
                    ...intersectionData,
                    sidewalk: sidewalkArray.join(' ')
                  });
                  console.log(`Changed ${direction} sidewalk to ${newValue}`);
                }}
              />
              <span> meters</span>
            </div>
            <div className="control-row">
              <label>Traffic Control:</label>
              <select
                value={
                  trafficsignalArray[index] === 1
                    ? 'signal'
                    : stopsignArray[index] === 1
                      ? 'stop'
                      : 'none'
                }
                onChange={(e) => {
                  const newValue = e.target.value;
                  const newStopsignArray = [...stopsignArray];
                  const newTrafficsignalArray = [...trafficsignalArray];

                  // Reset both arrays at this index
                  newStopsignArray[index] = 0;
                  newTrafficsignalArray[index] = 0;

                  // Set the appropriate array based on selection
                  if (newValue === 'stop') {
                    newStopsignArray[index] = 1;
                  } else if (newValue === 'signal') {
                    newTrafficsignalArray[index] = 1;
                  }

                  setStopsignArray(newStopsignArray);
                  setTrafficsignalArray(newTrafficsignalArray);
                  entity.setAttribute('intersection', {
                    ...intersectionData,
                    stopsign: newStopsignArray.join(' '),
                    trafficsignal: newTrafficsignalArray.join(' ')
                  });
                }}
              >
                <option value="none">None</option>
                <option value="stop">Stop Sign</option>
                <option value="signal">Traffic Signal</option>
              </select>
            </div>
          </div>
        </div>
        <div>Curbs</div>
        <div className="control-row">
          <label>Curb Position:</label>
          <select
            value={curb}
            onChange={(e) => {
              setCurb(e.target.value);
            }}
          >
            <option value="northeast">Northeast</option>
            <option value="northwest">Northwest</option>
            <option value="southeast">Southeast</option>
            <option value="southwest">Southwest</option>
          </select>
        </div>
        <div className="control-row">
          <label>Width:</label>
          <input
            type="number"
            value={curbArrays[curb][0]}
            onChange={handleCurbWidthChange}
          />
          <span> meters</span>
        </div>
        <div className="control-row">
          <label>Height:</label>
          <input
            type="number"
            value={curbArrays[curb][1]}
            onChange={handleCurbHeightChange}
          />
          <span> meters</span>
        </div>
      </div>
    </div>
  );
};

IntersectionSidebar.propTypes = {
  entity: PropTypes.object
};

export default IntersectionSidebar;
