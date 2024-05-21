describe('street-geo component', function() {
  let el;

  before((done) => {
    const scene = document.createElement('a-scene');
    document.body.appendChild(scene);
    el = document.createElement('a-entity');
    el.setAttribute('id', 'street-geo-test');
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
    expect(mapbox2dElement).to.exist;
  });

  it('should create a google3d element and delete mapbox2d element', (done) => {
    const mapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
    const google3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
    
    expect(mapbox2dElement).to.exist;

    el.setAttribute('street-geo', 'maps', 'google3d');

    setTimeout(() => {
      setTimeout(() => {
        const updatedMapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
        const updatedGoogle3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
        
        expect(updatedMapbox2dElement).to.not.exist;
        expect(updatedGoogle3dElement).to.exist;

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
        expect(mapbox2dElement).to.exist;
        expect(google3dElement).to.exist;
        done();
      });
    });  
  });

  it('should delete mapbox2d and google3d elements after setting maps attribute to empty', (done) => {
    const mapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
    const google3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
    
    expect(mapbox2dElement).to.exist;
    expect(google3dElement).to.exist;

    el.setAttribute('street-geo', 'maps', '');

    setTimeout(() => {
      setTimeout(() => {
        const updatedMapbox2dElement = el.querySelector('[data-layer-name="Mapbox Satellite Streets"]');
        const updatedGoogle3dElement = el.querySelector('[data-layer-name="Google 3D Tiles"]');
        
        expect(updatedMapbox2dElement).to.not.exist;
        expect(updatedGoogle3dElement).to.not.exist;
        
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
        expect(google3dElement).to.exist;

        const loader3dtilesAttr = google3dElement.getAttribute('loader-3dtiles');
        expect(loader3dtilesAttr.long).to.equal(40);
        expect(loader3dtilesAttr.lat).to.equal(50);
        expect(loader3dtilesAttr.height).to.equal(100 - 32.49158);

        done();
      });
    });  
  });
});
