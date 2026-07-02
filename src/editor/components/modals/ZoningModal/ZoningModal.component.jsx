import { useEffect, useState } from 'react';
import Modal from '@shared/components/Modal/Modal.jsx';
import { Button } from '../../elements/index.js';
import useStore from '@/store.js';
import { createParcelDataLayer } from '../../elements/AddLayerPanel/createLayerFunctions.js';

// ZoningViz hackathon POC: a multi-step wizard that runs a parcel
// redevelopment simulation (via a local ZoningViz server) for the scene's
// current geospatial location and adds the resulting buildings to the scene
// as an extruded geojson entity.
//
// Steps: 1) confirm location + jurisdiction  2) scenario parameters
//        3) run simulation, review, add to scene

const SERVER_URL = 'http://localhost:8081';

// POC jurisdiction detection by bounding box. A production version would ask
// the server which jurisdiction contains the point.
const JURISDICTION_BOUNDS = {
  sf: { minLon: -123.2, minLat: 37.6, maxLon: -122.28, maxLat: 37.94 },
  dc: { minLon: -77.13, minLat: 38.78, maxLon: -76.9, maxLat: 39.0 }
};

const detectJurisdiction = (lat, lon) => {
  for (const [name, b] of Object.entries(JURISDICTION_BOUNDS)) {
    if (
      lon >= b.minLon &&
      lon <= b.maxLon &&
      lat >= b.minLat &&
      lat <= b.maxLat
    ) {
      return name;
    }
  }
  return null;
};

const getSceneLocation = () => {
  const geoEl = document.querySelector('[street-geo]');
  if (!geoEl) return null;
  const geo = geoEl.getAttribute('street-geo');
  if (!geo) return null;
  const lat = Number(geo.latitude);
  const lon = Number(geo.longitude);
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
};

const bboxAround = (lat, lon, radiusM) => {
  const dLat = (radiusM / 40007863) * 360;
  const dLon = (radiusM / (40075017 * Math.cos((lat * Math.PI) / 180))) * 360;
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].join(',');
};

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: '4px' };
const labelStyle = { fontSize: '12px', color: '#aaa' };
const inputStyle = {
  background: '#2d2d2d',
  color: '#fff',
  border: '1px solid #555',
  borderRadius: '4px',
  padding: '6px 8px',
  fontSize: '14px'
};

const ZoningModal = () => {
  const isOpen = useStore((state) => state.modal === 'zoning');
  const setModal = useStore((state) => state.setModal);
  const onClose = () => setModal(null);

  const [step, setStep] = useState(1);
  const [location, setLocation] = useState(null);
  const [serverInfo, setServerInfo] = useState(null); // /health payload or {error}
  const [scenario, setScenario] = useState('current');
  const [years, setYears] = useState(20);
  const [seed, setSeed] = useState(42);
  const [radiusM, setRadiusM] = useState(600);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // simulate FeatureCollection
  const [error, setError] = useState(null);

  const jurisdiction = location
    ? detectJurisdiction(location.lat, location.lon)
    : null;
  const jurisdictionAvailable =
    jurisdiction && serverInfo?.jurisdictions?.includes(jurisdiction);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setResult(null);
    setError(null);
    setLocation(getSceneLocation());
    fetch(`${SERVER_URL}/health`)
      .then((res) => res.json())
      .then(setServerInfo)
      .catch(() =>
        setServerInfo({
          error: `Could not reach ZoningViz server at ${SERVER_URL}. Start it with: uvicorn server:app --port 8081`
        })
      );
  }, [isOpen]);

  const runSimulation = async (seedOverride) => {
    setRunning(true);
    setError(null);
    setResult(null);
    // A re-roll must use a fresh seed or the "new future" is the same future.
    // The seed field is updated so any outcome can still be reproduced.
    const effectiveSeed =
      seedOverride !== undefined ? seedOverride : Number(seed);
    if (seedOverride !== undefined) setSeed(seedOverride);
    try {
      const res = await fetch(`${SERVER_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jurisdiction,
          scenario,
          years: Number(years),
          seed: effectiveSeed,
          bbox: bboxAround(location.lat, location.lon, Number(radiusM)),
          developed_only: true
        })
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setResult(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const addToScene = () => {
    if (!result) return;
    // Same pattern as the AppMenu GeoJSON import, but anchored at the scene's
    // street-geo location so buildings line up with the 3D tiles.
    const entity = document.createElement('a-entity');
    entity.setAttribute('id', `zoning-sim-${scenario}-${Date.now()}`);
    entity.setAttribute(
      'data-layer-name',
      `Zoning Simulation • ${scenario} • ${years}yr`
    );
    entity.setAttribute('rotation', '0 -90 0'); // X+ north, matches geojson import
    document.querySelector('#street-container').appendChild(entity);
    entity.setAttribute('geojson', {
      data: JSON.stringify({
        type: 'FeatureCollection',
        features: result.features
      }),
      lat: location.lat,
      lon: location.lon
    });
    // A simulation is read through its parcels: make sure the tax-parcel data
    // layer is present so hover/click inspection works on the new buildings.
    // (The parcel layer remains usable standalone, without any simulation.)
    if (!document.querySelector('[parcel-data-layer]')) {
      createParcelDataLayer();
    }
    if (window.STREET?.notify) {
      STREET.notify.successMessage(
        `Added ${result.metadata.developed_count} simulated buildings (${scenario}, ${years} years)`
      );
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Zoning Simulation Wizard"
      closeOnClickOutside={false}
    >
      <div
        style={{
          width: '460px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          color: '#eee'
        }}
      >
        <div style={{ fontSize: '12px', color: '#888' }}>
          Step {step} of 3 —{' '}
          {step === 1 ? 'Location' : step === 2 ? 'Scenario' : 'Run & Review'}
        </div>

        {step === 1 && (
          <>
            {serverInfo?.error && (
              <div style={{ color: '#ff8a80', fontSize: '13px' }}>
                ⚠ {serverInfo.error}
              </div>
            )}
            {!location && (
              <div style={{ fontSize: '14px' }}>
                This scene has no geospatial location yet. Set one first, then
                re-open this wizard.
                <div style={{ marginTop: '12px' }}>
                  {/* rememberPrevious=true so the GeoModal's close returns
                      here (returnToPreviousModal) and the wizard resumes. */}
                  <Button onClick={() => setModal('geo', true)}>
                    Set Scene Location
                  </Button>
                </div>
              </div>
            )}
            {location && (
              <div style={{ fontSize: '14px', lineHeight: 1.7 }}>
                Scene location:{' '}
                <b>
                  {location.lat.toFixed(5)}, {location.lon.toFixed(5)}
                </b>
                <br />
                Detected jurisdiction:{' '}
                <b>{jurisdiction ? jurisdiction.toUpperCase() : 'unknown'}</b>
                {jurisdiction &&
                  !jurisdictionAvailable &&
                  !serverInfo?.error && (
                    <div style={{ color: '#ffcc80', marginTop: '8px' }}>
                      ⚠ The server has no parcel data for{' '}
                      {jurisdiction.toUpperCase()}. Run the ZoningViz fetch
                      pipeline for this jurisdiction first.
                    </div>
                  )}
                {!jurisdiction && (
                  <div style={{ color: '#ffcc80', marginTop: '8px' }}>
                    ⚠ This location is outside supported jurisdictions (SF, DC).
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div style={fieldStyle}>
              <label style={labelStyle}>Zoning scenario</label>
              <select
                style={inputStyle}
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                {(serverInfo?.scenarios || ['current']).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Years to simulate: {years}</label>
              <input
                type="range"
                min="5"
                max="50"
                value={years}
                onChange={(e) => setYears(e.target.value)}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>
                Area radius around scene center: {radiusM}m
              </label>
              <input
                type="range"
                min="200"
                max="1500"
                step="100"
                value={radiusM}
                onChange={(e) => setRadiusM(e.target.value)}
              />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>
                Random seed (same seed = same future)
              </label>
              <input
                type="number"
                style={inputStyle}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div style={{ fontSize: '13px', color: '#aaa' }}>
              {jurisdiction?.toUpperCase()} • scenario <b>{scenario}</b> •{' '}
              {years} years • {radiusM}m radius • seed {seed}
            </div>
            {!result && (
              <Button onClick={() => runSimulation()} disabled={running}>
                {running ? 'Simulating…' : 'Run Simulation'}
              </Button>
            )}
            {error && (
              <div style={{ color: '#ff8a80', fontSize: '13px' }}>
                ⚠ {error}
              </div>
            )}
            {result && (
              <div style={{ fontSize: '14px', lineHeight: 1.7 }}>
                <b>{result.metadata.developed_count}</b> of{' '}
                {result.metadata.parcels_in_bbox} parcels redevelop within{' '}
                {years} years under this scenario.
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                  <Button variant="filled" onClick={addToScene}>
                    Add Buildings to Scene
                  </Button>
                  <Button
                    onClick={() =>
                      runSimulation(Math.floor(Math.random() * 1000000))
                    }
                    disabled={running}
                  >
                    {running ? 'Simulating…' : 'Re-roll (new future)'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: '1px solid #444',
            paddingTop: '12px'
          }}
        >
          <Button onClick={() => (step > 1 ? setStep(step - 1) : onClose())}>
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          {step < 3 && (
            <Button
              variant="filled"
              disabled={
                (step === 1 && (!location || !jurisdictionAvailable)) || running
              }
              onClick={() => setStep(step + 1)}
            >
              Next
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export { ZoningModal };
