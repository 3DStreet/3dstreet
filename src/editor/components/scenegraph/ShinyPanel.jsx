import { useCallback, useEffect, useState } from 'react';
import { Button } from '../elements';

const DEMO_SRC = '/shiny/mock-streets.html';

// Reads the first `shiny-app` entity in the scene (if any) and returns its
// hosted-app config. The A-Frame `shiny-app` component dispatches
// `shiny-app-registered` on the window whenever it mounts/updates/unmounts.
function readShinyEntity() {
  const el = document.querySelector('a-entity[shiny-app]');
  if (!el) {
    return null;
  }
  const data = el.getAttribute('shiny-app') || {};
  return {
    el,
    src: data.src || DEMO_SRC,
    mapOutputId: data.mapOutputId || 'map'
  };
}

/**
 * ShinyPanel renders a hosted Shiny app in an <iframe>. The app's Leaflet map
 * output is "hijacked" and drawn in the 3D scene by the `shiny-app` A-Frame
 * component; everything else (inputs, plots, tables) renders here unchanged.
 */
export default function ShinyPanel() {
  const [app, setApp] = useState(() => readShinyEntity());

  const refresh = useCallback(() => setApp(readShinyEntity()), []);

  useEffect(() => {
    window.addEventListener('shiny-app-registered', refresh);
    return () => window.removeEventListener('shiny-app-registered', refresh);
  }, [refresh]);

  const addDemoApp = () => {
    if (!window.AFRAME || !window.AFRAME.INSPECTOR) {
      return;
    }
    AFRAME.INSPECTOR.execute('entitycreate', {
      'data-layer-name': 'Shiny App • SF Streets',
      components: {
        'shiny-app': {
          src: DEMO_SRC,
          mapOutputId: 'map'
        }
      }
    });
    // The component dispatches `shiny-app-registered`, but query again shortly
    // in case creation resolves after this tick.
    setTimeout(refresh, 100);
  };

  if (!app) {
    return (
      <div style={styles.empty}>
        <p style={styles.muted}>
          Host an R/Python <strong>Shiny</strong> app in this scene. Its map
          output renders in 3D; the rest of the UI appears here.
        </p>
        <Button variant="filled" onClick={addDemoApp}>
          Add Shiny App (SF Streets demo)
        </Button>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.toolbar}>
        <span style={styles.muted}>map output: {app.mapOutputId}</span>
        <Button variant="toolbtn" onClick={() => app.el.remove()}>
          Remove
        </Button>
      </div>
      <iframe
        id="shiny-app-frame"
        title="Shiny App"
        src={app.src}
        style={styles.iframe}
        // shinylive/webR runs R in-browser via WebAssembly; allow what it needs.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 8px',
    gap: '8px'
  },
  iframe: {
    flex: 1,
    width: '100%',
    border: 'none',
    background: '#fff',
    minHeight: 0
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    alignItems: 'flex-start'
  },
  muted: {
    color: '#999',
    fontSize: '12px',
    margin: 0
  }
};
