const assert = require('assert');
require('jsdom-global')();
const AFRAME = require('aframe/src');
require('../src/components/street-geo.js');

describe('street-geo component', function() {
  let el;

  before((done) => {
    const scene = document.createElement('a-scene');
    document.body.appendChild(scene);
    el = document.createElement('a-entity');
    el.setAttribute('street-geo', {
        longitude: 10,
        latitude: 20,
        elevation: 30,
        maps: 'mapbox2d'
    });
    scene.appendChild(el);

    setTimeout(() => {
      done();
    }, 500);
  });

  it('should create a mapbox2d element', () => {
    const mapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
    assert.ok(mapbox2dElement, 'mapbox2d element not created');
  });

  it('should create a google3d element and delete mapbox2d element', (done) => {
    const mapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
    const google3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
    
    assert.ok(mapbox2dElement, 'mapbox2d element not created');

    el.setAttribute('street-geo', 'maps', 'google3d');

    setTimeout(() => {
      setTimeout(() => {
        const updatedMapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
        const updatedGoogle3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
        
        assert.ok(!updatedMapbox2dElement, 'mapbox2d element not deleted');
        assert.ok(updatedGoogle3dElement, 'google3d element not created');

        done();
      });
    });
  });

  it('should create both mapbox2d and google3d elements', (done) => {
    el.setAttribute('street-geo', 'maps', 'mapbox2d, google3d');

    setTimeout(() => {
      setTimeout(() => {
        const mapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
        const google3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
        assert.ok(mapbox2dElement, 'mapbox2d element not created');
        assert.ok(google3dElement, 'google3d element not created');
        done();
      });
    });  
  });

  it('should delete mapbox2d and google3d elements after setting maps attribute to empty', (done) => {
    const mapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
    const google3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
    
    assert.ok(mapbox2dElement, 'mapbox2d element not created');
    assert.ok(google3dElement, 'google3d element not created');

    el.setAttribute('street-geo', 'maps', '');

    setTimeout(() => {
      setTimeout(() => {
        const updatedMapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
        const updatedGoogle3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
        
        assert.ok(!updatedMapbox2dElement, 'mapbox2d element not deleted');
        assert.ok(!updatedGoogle3dElement, 'google3d element not deleted');
        
        done();
      });
    });  
  });

  it('should update latitude, longitude, and elevation for google3d', (done) => {
    el.setAttribute('street-geo', 'maps', 'google3d');
    el.setAttribute('street-geo', 'longitude', 40);
    el.setAttribute('street-geo', 'latitude', 50);
    el.setAttribute('street-geo', 'elevation', 100);

    setTimeout(() => {
      setTimeout(() => {
        const google3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
        assert.ok(google3dElement, 'google3d element not created');

        const loader3dtilesAttr = google3dElement.getAttribute('loader-3dtiles');
        assert.strictEqual(loader3dtilesAttr.long, 40);
        assert.strictEqual(loader3dtilesAttr.lat, 50);
        assert.strictEqual(loader3dtilesAttr.height, 100 - 32.49158);

        done();
      });
    });  
  });
});
