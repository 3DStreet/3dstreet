/* global AFRAME */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import * as THREE from 'three';
import { AddLayerPanel } from '@/editor/components/elements/AddLayerPanel/AddLayerPanel.component.jsx';
import AssetsPanel from '@/editor/components/scenegraph/AssetsPanel.jsx';
import AssetDeepLinkModal from '@/editor/components/AssetDeepLinkModal.jsx';
import AppMenu from '@/editor/components/scenegraph/AppMenu.jsx';
import { dispatchToolCall } from '@/editor/lib/commands/registry.js';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';

// Every way of adding an item, with no group in the scene: the command each
// sends is written out here in full, as the editor has always sent it. The
// scene is plain DOM with an object3D per entity; the editor's execute only
// records. The expected ground points are worked out here from the camera,
// not by the editor's picker.

const given = {};
vi.mock('@shared/assets', async (importOriginal) => ({
  ...(await importOriginal()),
  AssetsPanelBody: (props) => {
    given.panel = props;
    return null;
  },
  AssetDetailModal: (props) => {
    given.modal = props;
    return null;
  }
}));
vi.mock('radix-ui', () => {
  // A stand-in for every menu part: its children, clickable.
  // eslint-disable-next-line react/prop-types
  const Pass = ({ children, onClick }) => (
    <div onClick={onClick}>{children}</div>
  );
  const Menubar = new Proxy({}, { get: () => Pass });
  return { Menubar };
});

// An entity element with an object3D that follows its position attribute.
if (!customElements.get('a-entity')) {
  customElements.define(
    'a-entity',
    class extends HTMLElement {
      constructor() {
        super();
        this.isEntity = true;
        this.object3D = new THREE.Group();
      }
      get parentEl() {
        return this.parentElement;
      }
      setAttribute(name, value) {
        if (name === 'position' && value && typeof value === 'object') {
          this.object3D.position.set(value.x, value.y, value.z);
          return super.setAttribute(name, `${value.x} ${value.y} ${value.z}`);
        }
        return super.setAttribute(name, value);
      }
    }
  );
}

const ASSET = {
  assetId: 'asset-7',
  ownerUid: 'owner-1',
  storageUrl: 'https://storage.example/asset-7.glb',
  name: 'Bench',
  type: 'mesh'
};
const RECT = { left: 0, top: 0, width: 1200, height: 800 };
const DROP = { clientX: 700, clientY: 500 };

let executed;
let camera;
let root;

beforeEach(() => {
  executed = [];
  const sceneEl = document.createElement('a-scene');
  sceneEl.isScene = true;
  sceneEl.object3D = new THREE.Scene();
  sceneEl.canvas = document.createElement('canvas');
  sceneEl.canvas.getBoundingClientRect = () => ({
    ...RECT,
    right: RECT.width,
    bottom: RECT.height
  });
  document.body.append(sceneEl);
  root = document.createElement('a-entity');
  root.id = 'street-container';
  sceneEl.append(root);
  camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 2000);
  camera.position.set(0, 30, 40);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const inspector = {
    camera,
    config: { defaultParent: '#street-container' },
    selectedEntity: null,
    execute: (type, payload) => {
      executed.push([type, payload]);
    }
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector, scenes: [sceneEl] });
  vi.stubGlobal('STREET', {
    notify: {
      successMessage: vi.fn(),
      errorMessage: vi.fn(),
      warningMessage: vi.fn(),
      infoMessage: vi.fn()
    },
    utils: { getCurrentSceneId: () => null, getAuthorId: () => null }
  });
  const assets = document.createElement('a-assets');
  assets.innerHTML = '<a-mixin id="tree3" category="plants"></a-mixin>';
  document.body.append(assets);
  useCurrentUploadStore.getState().clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// The ground (y = 0) under normalized device point (x, y).
function ground(x, y) {
  const ray = new THREE.Ray(
    camera.position.clone(),
    new THREE.Vector3(x, y, 1)
      .unproject(camera)
      .sub(camera.position)
      .normalize()
  );
  return ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Vector3()
  );
}
const viewCentre = () => ground(0, -0.1);
const dropPoint = () =>
  ground(
    (2 * DROP.clientX) / RECT.width - 1,
    -((2 * DROP.clientY) / RECT.height - 1)
  );

// A position a command carries, as numbers, whichever form it came in.
function xyz(position) {
  if (typeof position === 'string') return position.split(' ').map(Number);
  return [position.x, position.y, position.z];
}

function expectAt(position, point) {
  const [x, y, z] = xyz(position);
  expect(x).toBeCloseTo(point.x, 6);
  expect(y).toBeCloseTo(point.y, 6);
  expect(z).toBeCloseTo(point.z, 6);
}

function panel() {
  return render(
    <IntlProvider locale="en">
      <AddLayerPanel />
    </IntlProvider>
  );
}
const card = (name) => screen.getByText(name).closest('[draggable]');
const creates = () => executed.filter(([type]) => type === 'entitycreate');

// A drag event as the browser sends it, with client coordinates (jsdom has no
// DragEvent, and a plain Event carries none).
function drag(type, target, { dataTransfer, ...at } = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...at
  });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
}

function captureFileInputs() {
  const inputs = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const el = create(tag, options);
    if (tag === 'input') {
      el.click = () => {};
      inputs.push(el);
    }
    return el;
  });
  return inputs;
}

describe('adding an item with no group in the scene', () => {
  it('a catalog card click places the model on the ground at the middle of the view', () => {
    panel();
    fireEvent.click(screen.getByText('🌿 Plants'));
    fireEvent.click(card('Tree'));
    const [[, payload]] = creates();
    expect(Object.keys(payload).sort()).toEqual([
      'components',
      'data-layer-name',
      'mixin'
    ]);
    expect(payload.mixin).toBe('tree3');
    expect(payload['data-layer-name']).toBe('Tree');
    expect(Object.keys(payload.components)).toEqual(['position']);
    expectAt(payload.components.position, viewCentre());
  });

  it('a catalog card click with a street segment selected places the model in its street-prop holder', () => {
    const street = document.createElement('a-entity');
    root.append(street);
    const segment = document.createElement('a-entity');
    segment.className = 'segment-parent-0';
    segment.setAttribute('data-elevation-posY', '0.15');
    street.append(segment);
    AFRAME.INSPECTOR.selectedEntity = segment;
    panel();
    fireEvent.click(screen.getByText('🌿 Plants'));
    fireEvent.click(card('Tree'));
    const [[, payload]] = creates();
    const holder = segment.querySelector('.custom-group');
    expect(payload).toEqual({
      'data-layer-name': 'Tree',
      mixin: 'tree3',
      parentEl: holder,
      components: { position: { x: 0, y: 0, z: 0 } }
    });
    expect(holder.getAttribute('position')).toBe('0 0.15 0');
  });

  it('a card with its own builder places at the previewed point', () => {
    panel();
    fireEvent.click(screen.getByText('🔵 Shapes'));
    fireEvent.mouseEnter(card('Asphalt Circle'));
    fireEvent.click(card('Asphalt Circle'));
    fireEvent.click(card('Building Box'));
    const [[, circle], [, building]] = creates();
    expect(Object.keys(circle).sort()).toEqual([
      'components',
      'data-layer-name'
    ]);
    expect(circle['data-layer-name']).toBe('Geometry • Circle Asphalt');
    expect(circle.components.rotation).toBe('-90 -90 0');
    expectAt(circle.components.position, viewCentre());
    // Raised by half its 10 m height.
    expectAt(
      building.components.position,
      viewCentre().add({ x: 0, y: 5, z: 0 })
    );
    expect(building.parentEl).toBeUndefined();
  });

  it('dragging a card places at the dropped point', () => {
    panel();
    fireEvent.click(screen.getByText('🌿 Plants'));
    const data = {};
    const dataTransfer = {
      setData: (type, value) => {
        data[type] = value;
      },
      getData: (type) => data[type] ?? '',
      setDragImage: () => {},
      files: []
    };
    drag('dragstart', card('Tree'), { dataTransfer });
    const surface = [...document.body.children].find(
      (el) => el.tagName === 'DIV' && el.style.position === 'absolute'
    );
    drag('dragover', surface, { ...DROP, dataTransfer });
    drag('drop', surface, { ...DROP, dataTransfer });
    const [[, payload]] = creates();
    expect(Object.keys(payload).sort()).toEqual([
      'components',
      'data-layer-name',
      'mixin'
    ]);
    expectAt(payload.components.position, dropPoint());
  });

  it('dropping a file or a library asset places it at the dropped point', () => {
    panel();
    drag('drop', document.body, {
      ...DROP,
      dataTransfer: {
        types: ['Files'],
        files: [new File(['s'], 'garden.spz')],
        getData: () => ''
      }
    });
    useCurrentUploadStore.getState().clear();
    drag('drop', document.body, {
      ...DROP,
      dataTransfer: {
        types: ['application/x-3dstreet-asset'],
        files: [],
        getData: () => JSON.stringify(ASSET)
      }
    });
    const [[, upload], [, asset]] = creates();
    expect(upload.class).toBe('splat-model');
    expect(upload.parentEl).toBeUndefined();
    expect(upload.components['data-temporary-file']).toBe('true');
    expectAt(upload.components.position, dropPoint());
    expect(asset).toEqual({
      components: {
        position: asset.components.position,
        'data-layer-name': 'Bench',
        'data-asset-id': 'asset-7',
        'data-asset-owner-uid': 'owner-1',
        'gltf-model': 'url(https://storage.example/asset-7.glb)',
        shadow: 'receive: true; cast: true;'
      }
    });
    expectAt(asset.components.position, dropPoint());
  });

  it('the Assets panel and the asset link place at the view centre, and an upload or File > Import at the origin, all at the top level', () => {
    const inputs = captureFileInputs();
    render(
      <IntlProvider locale="en">
        <AssetsPanel />
        <AppMenu currentUser={null} />
      </IntlProvider>
    );
    window.location.hash = '#asset:owner-1/asset-7';
    render(<AssetDeepLinkModal />);
    given.panel.onPlaceAsset(ASSET);
    given.modal.onPlace(ASSET);
    // An upload places its item before anything is awaited; the rest of the
    // upload (which waits for the item to load) is not followed here.
    given.panel.onUpload(new File(['s'], 'a.spz'));
    useCurrentUploadStore.getState().clear();
    fireEvent.click(screen.getByText('Import...'));
    inputs[0].onchange({ target: { files: [new File(['s'], 'b.spz')] } });

    const [[, placed], [, linked], [, uploaded], [, imported]] = creates();
    for (const payload of [placed, linked]) {
      expect(payload.parentEl).toBeUndefined();
      expect(payload.components['data-asset-id']).toBe('asset-7');
      expectAt(payload.components.position, viewCentre());
    }
    for (const payload of [uploaded, imported]) {
      expect(payload.parentEl).toBeUndefined();
      expect(payload.components.position).toBe('0 0 0');
    }
  });

  it('an upload card places the upload at the previewed point', () => {
    const inputs = captureFileInputs();
    panel();
    fireEvent.click(screen.getByText('⚙️ Custom'));
    fireEvent.click(card('Upload 3D Model'));
    inputs[0].onchange({ target: { files: [new File(['s'], 'c.spz')] } });
    const [[, payload]] = creates();
    expect(payload.parentEl).toBeUndefined();
    expectAt(payload.components.position, viewCentre());
  });

  it('a polyline card places a shape at the top level', () => {
    panel();
    fireEvent.click(screen.getByText('🔵 Shapes'));
    fireEvent.click(card('Shape'));
    const [[, payload]] = creates();
    expect(payload.parentEl).toBeUndefined();
    expect(payload.components.shape).toBe('');
    expect(payload.children).toHaveLength(3);
  });

  it('the AI assistant creates at the values it gives, at the top level', async () => {
    await dispatchToolCall('entityCreate', {
      mixin: 'tree3',
      position: '12 0 5',
      rotation: '0 30 0'
    });
    expect(creates()).toEqual([
      [
        'entitycreate',
        {
          mixin: 'tree3',
          components: { position: '12 0 5', rotation: '0 30 0', scale: '1 1 1' }
        }
      ]
    ]);
  });
});
