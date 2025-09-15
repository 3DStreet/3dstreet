// A-Frame component to load 3D buildings from GeoJSON files
//
// This component renders polygon features from GeoJSON as extruded 3D buildings
// Designed for zoning, building, and other polygon-based geographic data
//
// Properties:
// * lat, lon: reference position for coordinate conversion (auto-calculated if 0,0)
// * src: GeoJSON file to load
//
// Supported GeoJSON properties:
// * height_meters: building height in meters
// * height_feet: building height in feet (converted to meters)
// * Any color properties for building appearance

AFRAME.registerComponent('geojson', {
  schema: {
    lat: { type: 'number' },
    lon: { type: 'number' },
    src: { type: 'asset' },
    data: { type: 'string' } // Store GeoJSON data directly as a stringified JSON
  },

  init: function () {
    this.EQUATOR_M = 40075017; // equatorial circumference in meters
    this.POLES_M = 40007863; // polar circumference in meters
    this.FEET_TO_METER = 0.3048;
    this.DEFAULT_BUILDING_HEIGHT_M = 10; // default height in meters for buildings without height

    // for loading a geojson file from the src asset
    this.loader = new THREE.FileLoader();
    this.onSrcLoaded = this.onSrcLoaded.bind(this);
  },

  update: function (oldData) {
    if (this.data !== oldData) {
      // reset the layer
      this.el.innerHTML = '';

      if (this.data.data) {
        // Use direct GeoJSON data if available (preferred for serialization)
        console.log('[GeoJSON Component] Using direct GeoJSON data...');
        this.onSrcLoaded(this.data.data);
      } else if (this.data.src) {
        // Fall back to loading from src URL
        this.loader.load(this.data.src, this.onSrcLoaded);
      }
    }
  },

  onSrcLoaded: function (text) {
    console.log('[GeoJSON Component] Source loaded, parsing JSON...');
    let json = JSON.parse(text);
    console.log('[GeoJSON Component] Parsed features:', json.features.length);

    if (this.data.lat === 0 && this.data.lon === 0) {
      console.log(
        '[GeoJSON Component] Lat/lon are 0,0 - calculating center from features...'
      );
      let center = this.features2center(json.features);
      console.log('[GeoJSON Component] Calculated center:', {
        lat: center[0],
        lon: center[1]
      });
      this.data.lat = center[0];
      this.data.lon = center[1];
    } else {
      console.log('[GeoJSON Component] Using provided coordinates:', {
        lat: this.data.lat,
        lon: this.data.lon
      });
    }

    this.addBuildings(json);
  },

  // Compute center of the given geojson features
  // we ignore point features and just take the first coordinate pair of each path
  // TODO: just use the bounding box center
  features2center: function (features) {
    let lat = 0;
    let lon = 0;
    let count = 0;
    for (let feature of features) {
      // just take the first coordinate pair of the outline, skip points
      let coords = feature.geometry.coordinates[0][0];
      if (coords && coords.length === 2) {
        lon += coords[0];
        lat += coords[1];
        count += 1;
      }
    }
    lat /= count;
    lon /= count;
    // console.log("Geojson center (lat, lon): ", lat, lon);
    return [lat, lon];
  },

  // Convert geocoordinates into meter-based positions around the given base
  // coordinates order in geojson is longitude, latitude!
  // coords is a path of [lon, lat] positions, e.g. [[13.41224,52.51712],[13.41150,52.51702],...]
  // result is a Vector2 array of positions in meters on the plane
  geojsonCoords2plane: function (coords, baseLat, baseLon) {
    if (coords.length === 1 && coords[0].length > 2) {
      // console.log(coords);
      coords = coords[0];
    }
    let circumferenceM = this.EQUATOR_M * Math.cos((baseLat * Math.PI) / 180);
    return coords.map(
      ([lon, lat]) =>
        new THREE.Vector2(
          ((lon - baseLon) / 360) * circumferenceM,
          ((lat - baseLat) / 360) * this.POLES_M
        )
    );
  },

  // Create the Aframe geometry by extruding building footprints to given height
  // xyCoords is a Vector2 array of x,y positions in meters
  // xyHoles is an optional array of Vector2 paths to describe holes in the building footprint
  // height is the building height in meters from the base to the top, null to use a default
  // if minHeight is given, the geometry is moved up to reach from minHeight to the top
  createGeometry: function (xyCoords, xyHoles, height, minHeight) {
    let shape = new THREE.Shape(xyCoords);
    if (height === null) {
      // set the height based on the perimeter of the building if missing other info
      let perimeterM = shape.getLength();
      height = Math.min(this.DEFAULT_BUILDING_HEIGHT_M, perimeterM / 5);
    }
    for (let hole of xyHoles) {
      shape.holes.push(new THREE.Path(hole));
    }
    height -= minHeight;
    let geometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false
    });

    // ExtrudeGeometry expects x and y as base shape and extrudes z, rotate to match
    geometry.rotateX(-Math.PI / 2);
    if (minHeight) {
      geometry.translate(0, minHeight, 0);
    }
    return geometry;
  },

  // Generate a dome / half sphere shaped building part from outline and height, both in meters
  // if minHeight is given, the shape is extruded from that height upwards
  // TODO: support elliptical domes (currently only circular)
  createDomeGeometry: function (xyCoords, height, minHeight = 0) {
    let bbox = new THREE.Box2().setFromPoints(xyCoords);
    let radiusM = (bbox.max.x - bbox.min.x) / 2;
    let center = new THREE.Vector2();
    bbox.getCenter(center);
    // use magic numbers to set default values, the Pi related values define a half sphere
    let geometry = new THREE.SphereGeometry(
      1,
      32,
      16,
      0,
      2 * Math.PI,
      0,
      0.5 * Math.PI
    );
    geometry.scale(radiusM, height - minHeight, radiusM);
    geometry.translate(center.x, minHeight, -center.y);
    return geometry;
  },

  // Convert a height string to meters, handling different units/formats
  height2meters: function (height) {
    if (height.indexOf("'") > 0) {
      // height given in feet and inches, convert to meter and ignore inches
      return parseFloat(height) * this.FEET_TO_METER;
    }
    // default unit is meters, parseFloat ignores any potentially appended " m"
    return parseFloat(height);
  },

  // Extract the height of a building from GeoJSON properties
  feature2height: function (feature) {
    let properties = feature.properties;

    // Check for height in meters (preferred)
    if ('height_meters' in properties) {
      return parseFloat(properties.height_meters);
    }

    // Check for height in feet and convert to meters
    if ('height_feet' in properties) {
      return parseFloat(properties.height_feet) * this.FEET_TO_METER;
    }

    // Check for generic height property
    if ('height' in properties) {
      return this.height2meters(properties.height);
    }

    // Return default height if no height property found
    return this.DEFAULT_BUILDING_HEIGHT_M;
  },

  // Building parts can define a minimum height for features like raised structures
  feature2minHeight: function (feature) {
    let properties = feature.properties;
    if ('min_height' in properties) {
      return this.height2meters(properties.min_height);
    }
    if ('min_height_meters' in properties) {
      return parseFloat(properties.min_height_meters);
    }
    if ('min_height_feet' in properties) {
      return parseFloat(properties.min_height_feet) * this.FEET_TO_METER;
    }
    return 0;
  },

  // Extract or estimate building color from properties
  feature2color: function (feature) {
    let properties = feature.properties;

    // Check for various color property names
    if ('color' in properties) {
      return properties.color;
    }
    if ('colour' in properties) {
      return properties.colour;
    }
    if ('building_color' in properties) {
      return properties.building_color;
    }
    if ('building:colour' in properties) {
      return properties['building:colour'];
    }

    // Generate color based on height for visual variety
    let height = this.feature2height(feature);
    let hue = Math.min(240, height * 2); // Blue to red based on height
    return `hsl(${hue}, 60%, 50%)`;
  },

  // Check if feature is of a specific shape like 'dome'
  hasShape: function (feature, shape) {
    return (
      ('shape' in feature.properties && feature.properties.shape === shape) ||
      ('building:shape' in feature.properties &&
        feature.properties['building:shape'] === shape) ||
      ('roof:shape' in feature.properties &&
        feature.properties['roof:shape'] === shape)
    );
  },

  // Convert the geojson feature of a building into a 3d geometry
  // baseLat and baseLon are used as reference position to convert geocoordinates to meters on plane
  feature2geometry: function (feature, baseLat, baseLon) {
    let paths = feature.geometry.coordinates;
    let xyOutline = this.geojsonCoords2plane(paths[0], baseLat, baseLon);
    let xyHoles = []; // Add holes to the building if more than one path given
    for (let i = 1; i < paths.length; i++) {
      xyHoles.push(this.geojsonCoords2plane(paths[i], baseLat, baseLon));
    }
    let heightM = this.feature2height(feature);
    if (heightM === 0) {
      return null; // skip building outlines that are covered by building parts
    }
    let minHeightM = this.feature2minHeight(feature);
    // special handling for dome shaped building parts
    if (this.hasShape(feature, 'dome')) {
      return this.createDomeGeometry(
        xyOutline,
        heightM,
        minHeightM
      ).toNonIndexed();
    }
    // ExtrudeGeometry is already non-indexed, unlike the SphereGeometry for domes
    return this.createGeometry(xyOutline, xyHoles, heightM, minHeightM);
  },

  // Iterate over features in geojson and add buildings to the scene
  addBuildings: function (geojson) {
    let count = 0;
    let skipped = 0;

    let geometries = [];

    for (let feature of geojson.features) {
      // Only process Polygon and MultiPolygon features
      if (
        feature.geometry.type !== 'Polygon' &&
        feature.geometry.type !== 'MultiPolygon'
      ) {
        skipped += 1;
        continue;
      }

      let geometry = this.feature2geometry(
        feature,
        this.data.lat,
        this.data.lon
      );
      if (geometry) {
        // Set color per vertex
        let color = new THREE.Color(this.feature2color(feature));
        const colors = [];
        const positionAttribute = geometry.getAttribute('position');
        for (let i = 0; i < positionAttribute.count; i++) {
          colors.push(color.r, color.g, color.b);
        }
        const colorAttribute = new THREE.Float32BufferAttribute(colors, 3);
        geometry.setAttribute('color', colorAttribute);
        geometries.push(geometry);

        count += 1;
      } else {
        skipped += 1;
      }
    }

    if (geometries.length > 0) {
      // merge all geometries and add them as one entity to the scene
      let geometry;
      if (
        THREE.BufferGeometryUtils &&
        THREE.BufferGeometryUtils.mergeGeometries
      ) {
        geometry = THREE.BufferGeometryUtils.mergeGeometries(geometries, false);
      } else {
        // If BufferGeometryUtils is not available, create individual entities
        console.warn(
          'BufferGeometryUtils not available, creating individual geometries'
        );
        for (let i = 0; i < geometries.length; i++) {
          let material = new THREE.MeshStandardMaterial({ vertexColors: true });
          let mesh = new THREE.Mesh(geometries[i], material);
          let entity = document.createElement('a-entity');
          entity.setObject3D('mesh', mesh);
          this.el.appendChild(entity);
        }
        return;
      }

      let material = new THREE.MeshStandardMaterial({ vertexColors: true });
      let mesh = new THREE.Mesh(geometry, material);
      let entity = document.createElement('a-entity');
      entity.setObject3D('mesh', mesh);
      this.el.appendChild(entity);
    }

    console.log(
      `[GeoJSON Component] Rendering complete: ${count} buildings loaded, ${skipped} features skipped`
    );
  }
});
