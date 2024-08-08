// AFrame component to load OpenStreetMap tiles around a given lat/lon, usually on a flat plane
//
// Internally we have to deal with 3 coordinate systems:
// * Geocoordinates (lat, lon) in degrees
//     -180                  180
//  90 +-----------+-----------+
//     |           |           |
//     |           |           |
//     +-----------+-----------+
//     |           |           |
//     |           |           |
// -90 +-----------+-----------+
//
// * Tile coordinates (x, y), i.e. 0 to 2^zoom - 1, as the map is divided into tiles
//   Tiles use the Web Mercator projection, assuming the earth is a sphere
//   See https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
//            0              2^zoom - 1
//          0 +-----------+-----------+
//            |    0,0    |    1,0    |  coordinates inside tiles for zoom level 1
//            |           |           |
//            +-----------+-----------+
//            |    0,1    |    1,1    |
//            |           |           |
// 2^zoom - 1 +-----------+-----------+
//
// * Plane coordinates (x, y) in meters, we take the start lat/lon as origin (0,0)
//      -inf                  inf
// -inf +-----------+-----------+
//      |           |   0,-1    |
//      |          -2,0 0,0 2,0 |
//      +-----------+-----------+
//      |           |           |
//      |           |           |
//  inf +-----------+-----------+


AFRAME.registerComponent('osm-tiles', {
  schema: {
    lat: { type: 'number' },
    lon: { type: 'number' },
    radius_m: { type: 'number', default: 500 },
    zoom: { type: 'number', default: 17 },
    trackId: { type: 'string' }, // component's id whose position we track for dynamic tile loading
    url: { type: 'string', default: 'https://tile.openstreetmap.org/' } // tileServer base url
  },

  init: function () {
    // console.log(this.data);
    this.tilesLoaded = new Set(); // contains each x,y tile id that has been added
  },

  // recreate the tiles layer
  update: function (oldData) {
    if (this.data !== oldData) {
      this.trackElement = null;
      this.trackPosition = null;
      // reset the layer
      this.el.innerHTML = '';
      this.tilesLoaded.clear();

      this.tileSize_m = this.lat2tileWidth_m(this.data.lat, this.data.zoom);
      this.tileBase = this.latlon2fractionalTileId(this.data.lat, this.data.lon);
      this.loadTilesAround(new THREE.Vector3(0, 0, 0));

      // if trackId attribute is given, keep track of the element's position
      if (this.data.trackId) {
        let element = document.getElementById(this.data.trackId);
        if (element && element.object3D) {
          this.trackElement = element;
          this.trackPosition = new THREE.Vector3();
        }
      }
    }
  },

  tick: function () {
    if (this.trackElement) {
      // use world position to support movement of both head and rig
      this.trackElement.object3D.getWorldPosition(this.trackPosition);
      this.loadTilesAround(this.trackPosition);
    }
  },

  // Convert latitude to width in meters for given zoom level
  lat2tileWidth_m: function (lat, zoom) {
    const EQUATOR_M = 40075017; // equatorial circumference in meters
    let nTiles = 2 ** zoom;
    let circumference_m = EQUATOR_M * Math.cos(lat * Math.PI / 180);
    return circumference_m / nTiles;
  },

  // Convert geocoordinates to tile coordinates for given zoom level
  // Returns floating point values where
  // * the integer part is the tile id
  // * the fractional part is the position within the tile
  latlon2fractionalTileId: function (lat, lon) {
    let nTiles = 2 ** this.data.zoom;
    let latRad = lat * Math.PI / 180;
    let x = nTiles * (lon + 180) / 360;
    let y = nTiles * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
    return [x, y];
  },

  // Create an Aframe plane with a given tile's image url, and size and position in meters
  // The plane position sets x,y although Aframe uses x,z for 3D, so needs to be rotated later
  createTile: function (x_m, y_m, url) {
    // console.log(x_m, y_m, url, this.tileSize_m);  
    let tile = document.createElement('a-plane');
    tile.setAttribute('src', url);
    tile.setAttribute('width', this.tileSize_m);
    tile.setAttribute('height', this.tileSize_m);
    tile.setAttribute('position', { x: x_m, y: y_m, z: 0 });
    tile.setAttribute('data-ignore-raycaster', '');
    return tile;
  },

  // Create an OpenStreetMap tile for given x,y tile coordinates and zoom level
  // Example url for Berlin center at zoom level 14: https://tile.openstreetmap.org/14/8802/5373.png
  // tileSize_m sets the width and length of the tile in meters
  //  for real-world size this depends on the zoom level and the latitude of the origin
  // tileBase is the (0,0) origin of the Aframe plane in tile coordinates [x,y]
  //  e.g. [8802.5, 5373.5] for the middle of the Berlin center tile at zoom level 14
  loadTile: function (x, y) {
    let url = this.data.url + `${this.data.zoom}/${x}/${y}.png`;
    let x_m = (x - this.tileBase[0] + 0.5) * this.tileSize_m;
    let y_m = (y - this.tileBase[1] + 0.5) * this.tileSize_m;
    let tile = this.createTile(x_m, -y_m, url);
    // let tile = this.createTile(x_m / this.tileSize_m, -y_m / this.tileSize_m, url, 1, 1);
    return tile;
  },

  // Check if all tiles within the default radius around the given position are loaded, load if not
  // pos is the position in meters on the Aframe plane, we ignore the height
  loadTilesAround: function (pos) {
    let tileX = this.tileBase[0] + pos.x / this.tileSize_m;
    let tileY = this.tileBase[1] + pos.z / this.tileSize_m;

    let radius = this.data.radius_m / this.tileSize_m;
    let nTiles = 2 ** this.data.zoom;
    let startX = Math.floor(tileX - radius);
    let startY = Math.max(0, Math.floor(tileY - radius));
    let endX = Math.ceil(tileX + radius);
    let endY = Math.min(nTiles, Math.ceil(tileY + radius));
    // using modulo for horizontal axis to wrap around the date line
    startX = (startX + nTiles) % nTiles;
    endX = (endX + nTiles) % nTiles;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        let xy = (y << this.data.zoom) + x;
        if (!this.tilesLoaded.has(xy)) {
          let tile = this.loadTile(x, y);
          this.el.appendChild(tile);
          this.tilesLoaded.add(xy);
        }
      }
    }
  }
});

// Aframe component to load buildings from a geojson file or the Overpass API
//
// lat, lon: start position of the map at Aframe's origin (0,0)
// src: optional geojson asset to load on init (loads all buildings inside regardless of lat/lon/radius_m)
// radius_m: radius in meters around the start position to load buildings from Overpass API
//   default is 0 to disable loading from Overpass API, otherwise 500 is a good value
// zoom: zoom level, to load all buildings of a tile at once (doesn't influence map details)
//   smaller values load more buildings at once but may slow down rendering, higher values cause more requests
// trackId: optional id of a scene element for dynamic loading (usually the rig / user position)
//
// The component supports different use cases:
// * show buildings from a geojson file: set src to the asset url
// * show buildings around a given lat/lon: set lat, lon and radius_m
// * keep loading buildings around a moving element: set lat, lon and radius_m, set trackId to the element's id
// * show buildings of a geojson file and keep loading around a moving element: use all attributes
//
// OSM map tiles use the Web Mercator projection, assuming the earth is a sphere
// OSM features/buildings use the WGS84 ellipsoid (different circumference across equator and poles)
// While building data is not tiled like the map, we still use a tile system to load efficiently

AFRAME.registerComponent('osm-geojson', {
  schema: {
    lat: { type: 'number' },
    lon: { type: 'number' },
    src: { type: 'asset' },
    radius_m: { type: 'number', default: 0 },
    zoom: { type: 'number', default: 17 },
    trackId: { type: 'string' }
  },

  init: function () {
    this.EQUATOR_M = 40075017; // equatorial circumference in meters
    this.POLES_M = 40007863; // polar circumference in meters
    this.FEET_TO_METER = 0.3048;
    this.LEVEL_HEIGHT_M = 3; // default height in meters for a single building level
    this.DEFAULT_BUILDING_HEIGHT_M = 6; // default height in meters for buildings without height
    // some default values for buildings defined at https://wiki.openstreetmap.org/wiki/Key:building
    this.BUILDING_TO_METER = {
      'church': 20,
      'water_tower': 20,
      'bungalow': this.LEVEL_HEIGHT_M,
      'cabin': this.LEVEL_HEIGHT_M,
      'ger': this.LEVEL_HEIGHT_M,
      'houseboat': this.LEVEL_HEIGHT_M,
      'static_caravan': this.LEVEL_HEIGHT_M,
      'kiosk': this.LEVEL_HEIGHT_M,
      'chapel': this.LEVEL_HEIGHT_M,
      'shrine': this.LEVEL_HEIGHT_M,
      'bakehouse': this.LEVEL_HEIGHT_M,
      'toilets': this.LEVEL_HEIGHT_M,
      'stable': this.LEVEL_HEIGHT_M,
      'boathouse': this.LEVEL_HEIGHT_M,
      'hut': this.LEVEL_HEIGHT_M,
      'shed': this.LEVEL_HEIGHT_M,
      'carport': this.LEVEL_HEIGHT_M,
      'garage': this.LEVEL_HEIGHT_M,
      'garages': this.LEVEL_HEIGHT_M,
      'beach_hut': this.LEVEL_HEIGHT_M,
      'container': this.LEVEL_HEIGHT_M,
      'guardhouse': this.LEVEL_HEIGHT_M
    }

    this.tilesLoaded = new Set(); // contains each x,y tile id that has been loaded
    this.featuresLoaded = {}; // contains each feature id that has been added

    // for loading a geojson file from the src asset
    this.loader = new THREE.FileLoader();
    this.onSrcLoaded = this.onSrcLoaded.bind(this);
  },

  update: function (oldData) {
    if (this.data !== oldData) {
      this.trackElement = null;
      this.trackPosition = null;
      // reset the layer
      this.el.innerHTML = '';
      this.tilesLoaded.clear();
      this.featuresLoaded = {};

      this.tileSize_m = this.lat2tileWidth_m(this.data.lat, this.data.zoom);
      this.tileBase = this.latlon2fractionalTileId(this.data.lat, this.data.lon);

      if (this.data.src) {
        this.loader.load(this.data.src, this.onSrcLoaded);
      }

      this.loadTilesAround(new THREE.Vector3(0, 0, 0));

      // if trackId attribute is given, keep track of the element's position
      if (this.data.trackId) {
        let element = document.getElementById(this.data.trackId);
        if (element && element.object3D) {
          this.trackElement = element;
          this.trackPosition = new THREE.Vector3();
        }
      }
    }
  },

  tick: function () {
    if (this.trackElement) {
      // use world position to support movement of both head and rig
      this.trackElement.object3D.getWorldPosition(this.trackPosition);
      this.loadTilesAround(this.trackPosition);
    }
  },

  onSrcLoaded: function (text) {
    let json = JSON.parse(text);
    if (this.data.lat == 0 && this.data.lon == 0) {
      let center = this.features2center(json.features);
      this.data.lat = center[0];
      this.data.lon = center[1];
    }
    this.addBuildings(json);
  },

  // Convert latitude to width in meters for given zoom level
  lat2tileWidth_m: function (lat, zoom) {
    let nTiles = 2 ** zoom;
    let circumference_m = this.EQUATOR_M * Math.cos(lat * Math.PI / 180);
    return circumference_m / nTiles;
  },

  // Convert geocoordinates to tile coordinates for given zoom level
  // Returns floating point values where
  // * the integer part is the tile id
  // * the fractional part is the position within the tile
  latlon2fractionalTileId: function (lat, lon) {
    let nTiles = 2 ** this.data.zoom;
    let latRad = lat * Math.PI / 180;
    let x = nTiles * (lon + 180) / 360;
    let y = nTiles * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
    return [x, y];
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
      if (coords && coords.length == 2) {
        lon += coords[0];
        lat += coords[1];
        count += 1;
      }
    }
    lat /= count;
    lon /= count;
    console.log("Geojson center (lat, lon): ", lat, lon);
    return [lat, lon];
  },

  // Load OSM building data for the bounding box
  // bboxArray is an array with [south,west,north,east] in degrees
  loadOSMbuildingsBbox: async function (bboxArray) {
    let bbox = bboxArray.join(',');
    // overpass query to get all buildings and building parts
    // adding skel to the last line may reduce the amount of data: out;>;out skel qt;
    let overpassQuery = `[out:json][timeout:30];(
        way["building"](${bbox});
        relation["building"]["type"="multipolygon"](${bbox});
        way["building:part"](${bbox});
        relation["building:part"]["type"="multipolygon"](${bbox});
        );out;>;out qt;
        `;

    let response = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: "data=" + encodeURIComponent(overpassQuery)
      }
    );
    if (response.ok) {
      let data = await response.json();
      console.log(data);
      return data;
    }
  },

  // Convert geocoordinates into meter-based positions around the given base
  // coordinates order in geojson is longitude, latitude!
  // coords is a path of [lon, lat] positions, e.g. [[13.41224,52.51712],[13.41150,52.51702],...] 
  geojsonCoords2plane: function (coords, baseLat, baseLon) {
    let circumference_m = this.EQUATOR_M * Math.cos(baseLat * Math.PI / 180);
    return coords.map(([lon, lat]) => [
      (lon - baseLon) / 360 * circumference_m,
      (lat - baseLat) / 360 * this.POLES_M
    ]);
  },

  // Create the Aframe geometry by extruding building footprints to given height
  // xyCoords is an array of [x,y] positions in meters, e.g. [[0, 0], [1, 0], [1, 1], [0, 1]]
  // xyHoles is an optional array of paths to describe holes in the building footprint
  // height is the building height in meters from the base to the top, null to use a default
  // if minHeight is given, the geometry is moved up to reach from minHeight to the top
  createGeometry: function (xyCoords, xyHoles, height, minHeight) {
    let shape = new THREE.Shape(xyCoords.map(xy => new THREE.Vector2(xy[0], xy[1])));
    if (height === null) {
      // set the height based on the perimeter of the building if missing other info
      let perimeter_m = shape.getLength();
      height = Math.min(this.DEFAULT_BUILDING_HEIGHT_M, perimeter_m / 5);
    }
    for (let hole of xyHoles) {
      shape.holes.push(new THREE.Path(hole.map(xy => new THREE.Vector2(xy[0], xy[1]))));
    }
    height -= minHeight;
    let geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });

    // ExtrudeGeometry expects x and y as base shape and extrudes z, rotate to match
    geometry.rotateX(-Math.PI / 2);
    if (minHeight) {
      geometry.translate(0, minHeight, 0);
    }
    return geometry;
  },

  // Generate a building from outline and height, both in meters
  // if minHeight is given, the building is extruded from that height upwards
  createBuilding: function (xyCoords, xyHoles, height, minHeight = 0) {
    // Create a mesh with the geometry and a material
    let geometry = this.createGeometry(xyCoords, xyHoles, height, minHeight);
    let material = new THREE.MeshBasicMaterial({ color: 0xaabbcc });
    let mesh = new THREE.Mesh(geometry, material);
    let entity = document.createElement('a-entity');
    entity.setObject3D('mesh', mesh);
    entity.setAttribute('data-ignore-raycaster', '');
    return entity;
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

  // Extract or estimate the height of a building
  // return null to set it later depending on the perimeter
  feature2height: function (feature) {
    // buildings can have a height defined with optional unit (default is meter)
    // https://wiki.openstreetmap.org/wiki/Key:height
    let properties = feature.properties;
    if ('height' in properties) {
      return this.height2meters(properties.height);
    }
    if ("building:levels" in properties) {
      return parseInt(properties["building:levels"]) * this.LEVEL_HEIGHT_M;
    }
    if (properties.building in this.BUILDING_TO_METER) {
      return this.BUILDING_TO_METER[properties.building];
    }
    if (properties.man_made in this.BUILDING_TO_METER) {
      return this.BUILDING_TO_METER[properties.man_made];
    }
    return null;
  },

  // Building parts can define a minimum height, so they start at a higher position, e.g. a roof
  // Alternatively, building:min_level can be used
  // https://wiki.openstreetmap.org/wiki/Key:min_height
  feature2minHeight: function (feature) {
    let properties = feature.properties;
    if ('min_height' in properties) {
      return this.height2meters(properties.min_height);
    }
    if ('building:min_level' in properties) {
      return parseInt(properties['building:min_level']) * this.LEVEL_HEIGHT_M;
    }
    return 0;
  },

  // Extract or estimate building colour
  feature2color: function (feature) {
    let properties = feature.properties;
    if ('building:colour' in properties) {
      return properties['building:colour'];
    }
    return 'gray';
  },

  // Convert the geojson feature of a building into a 3d Aframe entity
  // baseLat and baseLon are used as reference position to convert geocoordinates to meters on plane
  feature2building: function (feature, baseLat, baseLon) {
    let paths = feature.geometry.coordinates;
    let xyOutline = this.geojsonCoords2plane(paths[0], baseLat, baseLon);
    let xyHoles = []; // Add holes to the building if more than one path given
    for (let i = 1; i < paths.length; i++) {
      xyHoles.push(this.geojsonCoords2plane(paths[i], baseLat, baseLon));
    }
    let height_m = this.feature2height(feature);
    if (height_m === 0) {
      return null; // skip building outlines that are covered by building parts
    }
    let minHeight_m = this.feature2minHeight(feature);
    let building = this.createBuilding(xyOutline, xyHoles, height_m, minHeight_m);

    let color = this.feature2color(feature);
    let material = `color: ${color}; opacity: 1.0;`;
    building.setAttribute('material', material);
    return building;
  },

  // Compute the bounding box of a tile at given zoom level in degrees
  tile2bbox: function (x, y, zoom) {
    let nTiles = 2 ** zoom;
    let north = 180 * Math.atan(Math.sinh(Math.PI * (1 - 2 * y / nTiles))) / Math.PI;
    let south = 180 * Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / nTiles))) / Math.PI;
    let west = x / nTiles * 360 - 180;
    let east = (x + 1) / nTiles * 360 - 180;
    return [south, west, north, east];
  },

  // Iterate over features in geojson and add buildings to the scene
  addBuildings: function (geojson) {
    let count = 0;
    let ignored = 0;
    let skipped = 0;
    let buildings = new Set();
    let parts = [];

    // iterate over all features and add buildings to the scene
    for (let feature of geojson.features) {
      let properties = feature.properties;
      if (('building' in properties || 'building:part' in properties) && !this.featuresLoaded[feature.id]) {
        this.featuresLoaded[feature.id] = true;
        let building = this.feature2building(feature, this.data.lat, this.data.lon);
        if (building) {
          this.el.appendChild(building);
          count += 1;
          if ('building' in properties) {
            buildings.add(building);
          } else {
            parts.push(building);
          }
        } else {
          skipped += 1;
        }
      } else {
        if (!this.featuresLoaded[feature.id] && feature.geometry.type != 'Point') {
          // console.log(feature);
        }
        ignored += 1;
      }
    }

    // remove buildings that are covered by building parts
    // Unfortunately, there's no enforced relation:
    // https://help.openstreetmap.org/questions/60330/how-do-you-create-a-relation-between-a-building-and-3d-building-parts
    // TODO: optimise logic and performance if needed
    let outer = new THREE.Box3();
    let inner = new THREE.Box3();
    for (let part of parts) {
      let uselessBuildings = new Set();
      inner.setFromObject(part.object3D);
      for (let building of buildings) {
        if (part.object3D.position.distanceTo(building.object3D.position) < 1) {
          outer.setFromObject(building.object3D);
          if (outer.containsBox(inner)) {
            uselessBuildings.add(building);
          }
        }
      }
      for (let building of uselessBuildings) {
        this.el.removeChild(building);
        buildings.delete(building);
        count -= 1;
        skipped += 1;
      }
    }
    console.log("Loaded", count, "buildings, ignored", ignored, ", skipped", skipped);
  },

  // Check if all tiles within the default radius around the given position are fully loaded
  // otherwise load the missing ones as a single bounding box
  // pos is the position in meters on the Aframe plane, we ignore the height
  loadTilesAround: function (pos) {
    if (this.data.radius_m <= 0) {
      return;
    }
    let tileX = this.tileBase[0] + pos.x / this.tileSize_m;
    let tileY = this.tileBase[1] + pos.z / this.tileSize_m;

    let radius = this.data.radius_m / this.tileSize_m;
    let nTiles = 2 ** this.data.zoom;
    let startX = Math.floor(tileX - radius);
    let startY = Math.max(0, Math.floor(tileY - radius));
    let endX = Math.ceil(tileX + radius);
    let endY = Math.min(nTiles, Math.ceil(tileY + radius));
    // using modulo for horizontal axis to wrap around the date line
    startX = (startX + nTiles) % nTiles;
    endX = (endX + nTiles) % nTiles;
    // console.log(startX, startY, endX, endY);

    let bboxSWNE = []; // bounding box in [south,west,north,east] degrees
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        let xy = (y << this.data.zoom) + x;
        if (!this.tilesLoaded.has(xy)) {
          let bbox = this.tile2bbox(x, y, this.data.zoom);
          if (bboxSWNE.length == 0) {
            bboxSWNE = bbox;
          } else {
            bboxSWNE[0] = Math.min(bboxSWNE[0], bbox[0]);
            bboxSWNE[1] = Math.min(bboxSWNE[1], bbox[1]);
            bboxSWNE[2] = Math.max(bboxSWNE[2], bbox[2]);
            bboxSWNE[3] = Math.max(bboxSWNE[3], bbox[3]);
          }
          this.tilesLoaded.add(xy); // mark tile as loaded BEFORE the request to avoid multiple requests
        }
      }
    }

    if (bboxSWNE.length > 0) {
      console.log("Bounding box for missing tiles (SWNE): ", bboxSWNE);
      this.loadOSMbuildingsBbox(bboxSWNE).then((json) => {
        let geojson = osmtogeojson(json);
        this.addBuildings(geojson);
      });
    }
  }
});

// https://unpkg.com/osmtogeojson@3.0.0-beta.5/osmtogeojson.js
!function (e) { "object" == typeof exports && "undefined" != typeof module ? module.exports = e() : "function" == typeof define && define.amd ? define([], e) : ("undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this).osmtogeojson = e() }(function () { return function r(o, i, a) { function u(t, e) { if (!i[t]) { if (!o[t]) { var n = "function" == typeof require && require; if (!e && n) return n(t, !0); if (s) return s(t, !0); throw (e = new Error("Cannot find module '" + t + "'")).code = "MODULE_NOT_FOUND", e } n = i[t] = { exports: {} }, o[t][0].call(n.exports, function (e) { return u(o[t][1][e] || e) }, n, n.exports, r, o, i, a) } return i[t].exports } for (var s = "function" == typeof require && require, e = 0; e < a.length; e++)u(a[e]); return u }({ 1: [function (e, t, n) { var F = e("./lodash.custom.js"), L = e("@mapbox/geojson-rewind"), r = {}; function o(e, t) { return (e.version || t.version) && e.version !== t.version ? (+e.version || 0) > (+t.version || 0) ? e : t : F.merge(e, t) } e("osm-polygon-features").forEach(function (e) { var t, n; "all" === e.polygon ? r[e.key] = !0 : (t = "whitelist" === e.polygon ? "included_values" : "excluded_values", n = {}, e.values.forEach(function (e) { n[e] = !0 }), r[e.key] = {}, r[e.key][t] = n) }); function P(e) { function t(e) { return e[e.length - 1] } function n(e, t) { return void 0 !== e && void 0 !== t && e.id === t.id } for (var r, o, i, a, u, s, l = []; e.length;)for (r = e.pop().nodes.slice(), l.push(r); e.length && !n(r[0], t(r));) { for (o = r[0], i = t(r), a = 0; a < e.length; a++) { if (n(i, (s = e[a].nodes)[0])) { u = r.push, s = s.slice(1); break } if (n(i, t(s))) { u = r.push, s = s.slice(0, -1).reverse(); break } if (n(o, t(s))) { u = r.unshift, s = s.slice(0, -1); break } if (n(o, s[0])) { u = r.unshift, s = s.slice(1).reverse(); break } s = u = null } if (!s) break; e.splice(a, 1), u.apply(r, s) } return l } t.exports = (e = function (e, N, S) { var t, a, u, s, l, c; function f(e, t, n) { e.hasAttribute(n) && (t[n] = e.getAttribute(n)) } function p(e, t) { e = F.clone(e); f(t, e, "lat"), f(t, e, "lon"), e.__is_center_placeholder = !0, s.push(e) } function y(e, t) { var r = F.clone(e); function n(e, t, n) { n = { type: "node", id: "_" + r.type + "/" + r.id + "bounds" + n, lat: e, lon: t }; r.nodes.push(n.id), s.push(n) } r.nodes = [], n(t.getAttribute("minlat"), t.getAttribute("minlon"), 1), n(t.getAttribute("maxlat"), t.getAttribute("minlon"), 2), n(t.getAttribute("maxlat"), t.getAttribute("maxlon"), 3), n(t.getAttribute("minlat"), t.getAttribute("maxlon"), 4), r.nodes.push(r.nodes[0]), r.__is_bounds_placeholder = !0, l.push(r) } function d(r, e) { F.isArray(r.nodes) || (r.nodes = [], F.each(e, function (e, t) { r.nodes.push("_anonymous@" + e.getAttribute("lat") + "/" + e.getAttribute("lon")) })), F.each(e, function (e, t) { var n; e.getAttribute("lat") && (n = e.getAttribute("lat"), e = e.getAttribute("lon"), t = { type: "node", id: t = r.nodes[t], lat: n, lon: e }, s.push(t)) }) } function g(i, e) { function a(e, t) { var n; l.some(function (e) { return "way" == e.type && e.id == t }) || (n = { type: "way", id: t, nodes: [] }, F.each(e, function (e) { var t; e.getAttribute("lat") ? (t = e.getAttribute("lat"), e = e.getAttribute("lon"), t = { type: "node", id: "_anonymous@" + t + "/" + e, lat: t, lon: e }, n.nodes.push(t.id), s.push(t)) : n.nodes.push(void 0) }), l.push(n)) } F.each(e, function (e, t) { var n, r, o; "node" == i.members[t].type ? e.getAttribute("lat") && (n = e.getAttribute("lat"), r = e.getAttribute("lon"), o = i.members[t].ref, s.push({ type: "node", id: o, lat: n, lon: r })) : "way" == i.members[t].type && 0 < e.getElementsByTagName("nd").length && (i.members[t].ref = "_fullGeom" + i.members[t].ref, a(e.getElementsByTagName("nd"), i.members[t].ref)) }) } return N = F.merge({ verbose: !1, flatProperties: !0, uninterestingTags: { source: !0, source_ref: !0, "source:ref": !0, history: !0, attribution: !0, created_by: !0, "tiger:county": !0, "tiger:tlid": !0, "tiger:upload_uuid": !0 }, polygonFeatures: r, deduplicator: o }, N), "undefined" != typeof XMLDocument && e instanceof XMLDocument || "undefined" == typeof XMLDocument && e.childNodes ? (t = e, s = new Array, l = new Array, c = new Array, F.each(t.getElementsByTagName("node"), function (e, t) { var n = {}, r = (F.each(e.getElementsByTagName("tag"), function (e) { n[e.getAttribute("k")] = e.getAttribute("v") }), { type: "node" }); f(e, r, "id"), f(e, r, "lat"), f(e, r, "lon"), f(e, r, "version"), f(e, r, "timestamp"), f(e, r, "changeset"), f(e, r, "uid"), f(e, r, "user"), F.isEmpty(n) || (r.tags = n), s.push(r) }), F.each(t.getElementsByTagName("way"), function (e, t) { var n = {}, r = [], o = (F.each(e.getElementsByTagName("tag"), function (e) { n[e.getAttribute("k")] = e.getAttribute("v") }), !1), i = (F.each(e.getElementsByTagName("nd"), function (e, t) { var n; (n = e.getAttribute("ref")) && (r[t] = n), !o && e.getAttribute("lat") && (o = !0) }), { type: "way" }); f(e, i, "id"), f(e, i, "version"), f(e, i, "timestamp"), f(e, i, "changeset"), f(e, i, "uid"), f(e, i, "user"), 0 < r.length && (i.nodes = r), F.isEmpty(n) || (i.tags = n), (a = e.getElementsByTagName("center")[0]) && p(i, a), o ? d(i, e.getElementsByTagName("nd")) : (u = e.getElementsByTagName("bounds")[0]) && y(i, u), l.push(i) }), F.each(t.getElementsByTagName("relation"), function (e, t) { var n = {}, r = [], o = (F.each(e.getElementsByTagName("tag"), function (e) { n[e.getAttribute("k")] = e.getAttribute("v") }), !1), i = (F.each(e.getElementsByTagName("member"), function (e, t) { r[t] = {}, f(e, r[t], "ref"), f(e, r[t], "role"), f(e, r[t], "type"), (!o && "node" == r[t].type && e.getAttribute("lat") || "way" == r[t].type && 0 < e.getElementsByTagName("nd").length) && (o = !0) }), { type: "relation" }); f(e, i, "id"), f(e, i, "version"), f(e, i, "timestamp"), f(e, i, "changeset"), f(e, i, "uid"), f(e, i, "user"), 0 < r.length && (i.members = r), F.isEmpty(n) || (i.tags = n), (a = e.getElementsByTagName("center")[0]) && p(i, a), o ? g(i, e.getElementsByTagName("member")) : (u = e.getElementsByTagName("bounds")[0]) && y(i, u), c.push(i) }), h(s, l, c)) : function (e) { var a = new Array, o = new Array, t = new Array; function n(e) { var t = F.clone(e); t.lat = e.center.lat, t.lon = e.center.lon, t.__is_center_placeholder = !0, a.push(t) } function r(e) { var r = F.clone(e); function t(e, t, n) { n = { type: "node", id: "_" + r.type + "/" + r.id + "bounds" + n, lat: e, lon: t }; r.nodes.push(n.id), a.push(n) } r.nodes = [], t(r.bounds.minlat, r.bounds.minlon, 1), t(r.bounds.maxlat, r.bounds.minlon, 2), t(r.bounds.maxlat, r.bounds.maxlon, 3), t(r.bounds.minlat, r.bounds.maxlon, 4), r.nodes.push(r.nodes[0]), r.__is_bounds_placeholder = !0, o.push(r) } function i(r) { F.isArray(r.nodes) || (r.nodes = r.geometry.map(function (e) { return null !== e ? "_anonymous@" + e.lat + "/" + e.lon : "_anonymous@unknown_location" })), r.geometry.forEach(function (e, t) { var n; e && (n = e.lat, e = e.lon, t = r.nodes[t], a.push({ type: "node", id: t, lat: n, lon: e })) }) } function u(e) { function i(e, t) { var n; o.some(function (e) { return "way" == e.type && e.id == t }) || (n = { type: "way", id: t, nodes: [] }, e.forEach(function (e) { var t; e ? (t = e.lat, e = e.lon, t = { type: "node", id: "_anonymous@" + t + "/" + e, lat: t, lon: e }, n.nodes.push(t.id), a.push(t)) : n.nodes.push(void 0) }), o.push(n)) } e.members.forEach(function (e, t) { var n, r, o; "node" == e.type ? e.lat && (n = e.lat, r = e.lon, o = e.ref, a.push({ type: "node", id: o, lat: n, lon: r })) : "way" == e.type && e.geometry && (e.ref = "_fullGeom" + e.ref, i(e.geometry, e.ref)) }) } for (var s = 0; s < e.elements.length; s++)switch (e.elements[s].type) { case "node": var l = e.elements[s]; a.push(l); break; case "way": l = F.clone(e.elements[s]); l.nodes = F.clone(l.nodes), o.push(l), l.center && n(l), l.geometry ? i(l) : l.bounds && r(l); break; case "relation": var c = F.clone(e.elements[s]), f = (c.members = F.clone(c.members), t.push(c), c.members && c.members.some(function (e) { return "node" == e.type && e.lat || "way" == e.type && e.geometry && 0 < e.geometry.length })); c.center && n(c), f ? u(c) : c.bounds && r(c) }return h(a, o, t) }(e); function h(e, t, n) { function r(e, t) { if ("object" != typeof t && (t = {}), "function" == typeof N.uninterestingTags) return !N.uninterestingTags(e, t); for (var n in e) if (!0 !== N.uninterestingTags[n] && !0 !== t[n] && t[n] !== e[n]) return 1 } function p(e) { var t, n = { timestamp: e.timestamp, version: e.version, changeset: e.changeset, user: e.user, uid: e.uid }; for (t in n) void 0 === n[t] && delete n[t]; return n } for (var o = new Object, i = new Object, a = 0; a < e.length; a++)void 0 !== (o[(f = void 0 !== o[(f = e[a]).id] ? N.deduplicator(f, o[f.id]) : f).id] = f).tags && r(f.tags) && (i[f.id] = !0); for (a = 0; a < n.length; a++)if (F.isArray(n[a].members)) for (var u = 0; u < n[a].members.length; u++)"node" == n[a].members[u].type && (i[n[a].members[u].ref] = !0); for (var y = new Object, s = new Object, a = 0; a < t.length; a++) { var l = t[a]; if (y[l.id] && (l = N.deduplicator(l, y[l.id])), y[l.id] = l, F.isArray(l.nodes)) for (u = 0; u < l.nodes.length; u++)"object" != typeof l.nodes[u] && (s[l.nodes[u]] = !0, l.nodes[u] = o[l.nodes[u]]) } var c = new Array; for (g in o) { var f = o[g]; s[g] && !i[g] || c.push(f) } for (var d = new Array, a = 0; a < n.length; a++)d[(m = d[(m = n[a]).id] ? N.deduplicator(m, d[m.id]) : m).id] = m; var g, h, b = { node: {}, way: {}, relation: {} }; for (g in d) { var m = d[g]; if (F.isArray(m.members)) for (u = 0; u < m.members.length; u++) { var v = m.members[u].type, _ = m.members[u].ref; "number" != typeof _ && (_ = _.replace("_fullGeom", "")), b[v] ? (void 0 === b[v][_] && (b[v][_] = []), b[v][_].push({ role: m.members[u].role, rel: m.id, reltags: m.tags })) : N.verbose && console.warn("Relation", m.type + "/" + m.id, "member", v + "/" + _, "ignored because it has an invalid type") } else N.verbose && console.warn("Relation", m.type + "/" + m.id, "ignored because it has no members") } var w = []; for (a = 0; a < c.length; a++)void 0 === c[a].lon || void 0 === c[a].lat ? N.verbose && console.warn("POI", c[a].type + "/" + c[a].id, "ignored because it lacks coordinates") : (E = { type: "Feature", id: c[a].type + "/" + c[a].id, properties: { type: c[a].type, id: c[a].id, tags: c[a].tags || {}, relations: b.node[c[a].id] || [], meta: p(c[a]) }, geometry: { type: "Point", coordinates: [+c[a].lon, +c[a].lat] } }, c[a].__is_center_placeholder && (E.properties.geometry = "center"), S ? S(E) : w.push(E)); for (var j = [], A = [], a = 0; a < n.length; a++)if (d[n[a].id] === n[a]) { if (void 0 !== n[a].tags && ("route" == n[a].tags.type || "waterway" == n[a].tags.type)) { if (!F.isArray(n[a].members)) { N.verbose && console.warn("Route", n[a].type + "/" + n[a].id, "ignored because it has no members"); continue } if (n[a].members.forEach(function (e) { y[e.ref] && !r(y[e.ref].tags) && (y[e.ref].is_skippablerelationmember = !0) }), !1 === (E = function (n) { var r = !1, e = (t = (t = n.members.filter(function (e) { return "way" === e.type })).map(function (t) { var e = y[t.ref]; if (void 0 !== e && void 0 !== e.nodes) return { id: t.ref, role: t.role, way: e, nodes: e.nodes.filter(function (e) { return void 0 !== e || (r = !0, N.verbose && console.warn("Route", n.type + "/" + n.id, "tainted by a way", t.type + "/" + t.ref, "with a missing node"), !1) }) }; N.verbose && console.warn("Route " + n.type + "/" + n.id, "tainted by a missing or incomplete  way", t.type + "/" + t.ref), r = !0 }), t = F.compact(t), t = P(t), []); if (0 == (e = F.compact(t.map(function (e) { return F.compact(e.map(function (e) { return [+e.lon, +e.lat] })) }))).length) return N.verbose && console.warn("Route", n.type + "/" + n.id, "contains no coordinates"), !1; var t = { type: "Feature", id: n.type + "/" + n.id, properties: { type: n.type, id: n.id, tags: n.tags || {}, relations: b[n.type][n.id] || [], meta: p(n) }, geometry: { type: 1 === e.length ? "LineString" : "MultiLineString", coordinates: 1 === e.length ? e[0] : e } }; r && (N.verbose && console.warn("Route", n.type + "/" + n.id, "is tainted"), t.properties.tainted = !0); return t }(n[a]))) { N.verbose && console.warn("Route relation", n[a].type + "/" + n[a].id, "ignored because it has invalid geometry"); continue } S ? S(L(E)) : A.push(E) } if (void 0 !== n[a].tags && ("multipolygon" == n[a].tags.type || "boundary" == n[a].tags.type)) { if (F.isArray(n[a].members)) { for (var k = 0, u = 0; u < n[a].members.length; u++)"outer" == n[a].members[u].role ? k++ : N.verbose && "inner" != n[a].members[u].role && console.warn("Multipolygon", n[a].type + "/" + n[a].id, "member", n[a].members[u].type + "/" + n[a].members[u].ref, 'ignored because it has an invalid role: "' + n[a].members[u].role + '"'); if (n[a].members.forEach(function (e) { y[e.ref] && ("outer" !== e.role || r(y[e.ref].tags, n[a].tags) || (y[e.ref].is_skippablerelationmember = !0), "inner" !== e.role || r(y[e.ref].tags) || (y[e.ref].is_skippablerelationmember = !0)) }), 0 == k) N.verbose && console.warn("Multipolygon relation", n[a].type + "/" + n[a].id, "ignored because it has no outer ways"); else { var O = !1, E = null; if (O = 1 != k || r(n[a].tags, { type: !0 }) ? O : !0) { var x = n[a].members.filter(function (e) { return "outer" === e.role })[0]; if (void 0 === (x = y[x.ref])) { N.verbose && console.warn("Multipolygon relation", n[a].type + "/" + n[a].id, "ignored because outer way", x.type + "/" + x.ref, "is missing"); continue } x.is_skippablerelationmember = !0, E = T(x, n[a]) } else E = T(n[a], n[a]); !1 === E ? N.verbose && console.warn("Multipolygon relation", n[a].type + "/" + n[a].id, "ignored because it has invalid geometry") : S ? S(L(E)) : A.push(E) } } else N.verbose && console.warn("Multipolygon", n[a].type + "/" + n[a].id, "ignored because it has no members"); function T(e, t) { var n = !1, r = O ? "way" : "relation", o = "number" == typeof e.id ? e.id : +e.id.replace("_fullGeom", ""); function i(e) { function t(e) { return e.map(function (e) { return [+e.lat, +e.lon] }) } var n; for (e = t(e), n = 0; n < a.length; n++)if (function (e, t) { for (var n = 0; n < t.length; n++)if (function (e, t) { for (var n = e[0], r = e[1], o = false, i = 0, a = t.length - 1; i < t.length; a = i++) { var u = t[i][0], s = t[i][1]; var l = t[a][0], c = t[a][1]; var f = s > r != c > r && n < (l - u) * (r - s) / (c - s) + u; if (f) o = !o } return o }(t[n], e)) return !0; return !1 }(t(a[n]), e)) return n } t = (t = t.members.filter(function (e) { return "way" === e.type })).map(function (t) { var e = y[t.ref]; if (void 0 !== e && void 0 !== e.nodes) return { id: t.ref, role: t.role || "outer", way: e, nodes: e.nodes.filter(function (e) { return void 0 !== e || (n = !0, N.verbose && console.warn("Multipolygon", r + "/" + o, "tainted by a way", t.type + "/" + t.ref, "with a missing node"), !1) }) }; N.verbose && console.warn("Multipolygon", r + "/" + o, "tainted by a missing or incomplete way", t.type + "/" + t.ref), n = !0 }); for (var a = P((t = F.compact(t)).filter(function (e) { return "outer" === e.role })), u = P(t.filter(function (e) { return "inner" === e.role })), s = a.map(function (e) { return [e] }), l = 0; l < u.length; l++) { var c = i(u[l]); void 0 !== c ? s[c].push(u[l]) : N.verbose && console.warn("Multipolygon", r + "/" + o, "contains an inner ring with no containing outer") } var f, t = []; return 0 == (t = F.compact(s.map(function (e) { e = F.compact(e.map(function (e) { if (!(e.length < 4)) return F.compact(e.map(function (e) { return [+e.lon, +e.lat] })); N.verbose && console.warn("Multipolygon", r + "/" + o, "contains a ring with less than four nodes") })); if (0 != e.length) return e; N.verbose && console.warn("Multipolygon", r + "/" + o, "contains an empty ring cluster") }))).length ? (N.verbose && console.warn("Multipolygon", r + "/" + o, "contains no coordinates"), !1) : (f = "MultiPolygon", 1 === t.length && (f = "Polygon", t = t[0]), e = { type: "Feature", id: e.type + "/" + o, properties: { type: e.type, id: o, tags: e.tags || {}, relations: b[e.type][e.id] || [], meta: p(e) }, geometry: { type: f, coordinates: t } }, n && (N.verbose && console.warn("Multipolygon", r + "/" + o, "is tainted"), e.properties.tainted = !0), e) } } } for (a = 0; a < t.length; a++)if (y[t[a].id] === t[a]) if (F.isArray(t[a].nodes)) { if (!t[a].is_skippablerelationmember) { "number" != typeof t[a].id && (t[a].id = +t[a].id.replace("_fullGeom", "")), t[a].tainted = !1, t[a].hidden = !1; var M, B = new Array; for (u = 0; u < t[a].nodes.length; u++)"object" == typeof t[a].nodes[u] ? B.push([+t[a].nodes[u].lon, +t[a].nodes[u].lat]) : (N.verbose && console.warn("Way", t[a].type + "/" + t[a].id, "is tainted by an invalid node"), t[a].tainted = !0); B.length <= 1 ? N.verbose && console.warn("Way", t[a].type + "/" + t[a].id, "ignored because it contains too few nodes") : (M = "LineString", void 0 !== t[a].nodes[0] && void 0 !== t[a].nodes[t[a].nodes.length - 1] && t[a].nodes[0].id === t[a].nodes[t[a].nodes.length - 1].id && (void 0 !== t[a].tags && function (e) { var t = N.polygonFeatures; if ("function" == typeof t) return t(e); if ("no" !== e.area) for (var n in e) { var r = e[n], n = t[n]; if (void 0 !== n && "no" !== r) { if (!0 === n) return 1; if (n.included_values && !0 === n.included_values[r]) return 1; if (n.excluded_values && !0 !== n.excluded_values[r]) return 1 } } return }(t[a].tags) || t[a].__is_bounds_placeholder) && (M = "Polygon", B = [B]), E = { type: "Feature", id: t[a].type + "/" + t[a].id, properties: { type: t[a].type, id: t[a].id, tags: t[a].tags || {}, relations: b.way[t[a].id] || [], meta: p(t[a]) }, geometry: { type: M, coordinates: B } }, t[a].tainted && (N.verbose && console.warn("Way", t[a].type + "/" + t[a].id, "is tainted"), E.properties.tainted = !0), t[a].__is_bounds_placeholder && (E.properties.geometry = "bounds"), S ? S(L(E)) : ("LineString" == M ? j : A).push(E)) } } else N.verbose && console.warn("Way", t[a].type + "/" + t[a].id, "ignored because it has no nodes"); return !!S || ((h = { type: "FeatureCollection", features: [] }).features = h.features.concat(A), h.features = h.features.concat(j), h.features = h.features.concat(w), N.flatProperties && h.features.forEach(function (e) { e.properties = F.merge(e.properties.meta, e.properties.tags, { id: e.properties.type + "/" + e.properties.id }) }), L(h)) } }).toGeojson = e }, { "./lodash.custom.js": 2, "@mapbox/geojson-rewind": 3, "osm-polygon-features": 4 }], 2: [function (e, Ht, Jt) { !function (Xt) { !function () { !function () { var R, h = "__lodash_hash_undefined__", I = 1, $ = 2, b = 1 / 0, _ = 9007199254740991, C = "[object Arguments]", ee = "[object Array]", te = "[object Boolean]", ne = "[object Date]", re = "[object Error]", w = "[object Function]", j = "[object GeneratorFunction]", D = "[object Map]", oe = "[object Number]", G = "[object Object]", A = "[object Promise]", ie = "[object RegExp]", U = "[object Set]", ae = "[object String]", ue = "[object Symbol]", k = "[object WeakMap]", se = "[object ArrayBuffer]", z = "[object DataView]", O = "[object Float32Array]", E = "[object Float64Array]", x = "[object Int8Array]", T = "[object Int16Array]", M = "[object Int32Array]", B = "[object Uint8Array]", N = "[object Uint8ClampedArray]", S = "[object Uint16Array]", F = "[object Uint32Array]", L = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/, P = /^\w*$/, le = /^\./, ce = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g, fe = /\\(\\)?/g, pe = /\w*$/, ye = /^\[object .+?Constructor\]$/, de = /^(?:0|[1-9]\d*)$/, t = {}, d = (t[O] = t[E] = t[x] = t[T] = t[M] = t[B] = t[N] = t[S] = t[F] = !0, t[C] = t[ee] = t[se] = t[te] = t[z] = t[ne] = t[re] = t[w] = t[D] = t[oe] = t[G] = t[ie] = t[U] = t[ae] = t[k] = !1, {}), e = (d[C] = d[ee] = d[se] = d[z] = d[te] = d[ne] = d[O] = d[E] = d[x] = d[T] = d[M] = d[D] = d[oe] = d[G] = d[ie] = d[U] = d[ae] = d[ue] = d[B] = d[N] = d[S] = d[F] = !0, d[re] = d[w] = d[k] = !1, "object" == typeof Xt && Xt && Xt.Object === Object && Xt), n = "object" == typeof self && self && self.Object === Object && self, n = e || n || Function("return this")(), ge = "object" == typeof Jt && Jt && !Jt.nodeType && Jt, he = ge && "object" == typeof Ht && Ht && !Ht.nodeType && Ht, be = he && he.exports === ge, me = be && e.process, e = function () { try { return me && me.binding("util") } catch (e) { } }(), e = e && e.isTypedArray; function ve(e, t) { return e.set(t[0], t[1]), e } function _e(e, t) { return e.add(t), e } function we(e, t) { for (var n = -1, r = e ? e.length : 0; ++n < r && !1 !== t(e[n], n, e);); return e } function je(e, t, n, r) { var o = -1, i = e ? e.length : 0; for (r && i && (n = e[++o]); ++o < i;)n = t(n, e[o], o, e); return n } function W(e) { var t = !1; if (null != e && "function" != typeof e.toString) try { t = !!(e + "") } catch (e) { } return t } function Ae(e) { var n = -1, r = Array(e.size); return e.forEach(function (e, t) { r[++n] = [t, e] }), r } function ke(t, n) { return function (e) { return t(n(e)) } } function Oe(e) { var t = -1, n = Array(e.size); return e.forEach(function (e) { n[++t] = e }), n } var Ee = Array.prototype, r = Function.prototype, xe = Object.prototype, o = n["__core-js_shared__"], Te = (o = /[^.]+$/.exec(o && o.keys && o.keys.IE_PROTO || "")) ? "Symbol(src)_1." + o : "", Me = r.toString, q = xe.hasOwnProperty, Be = Me.call(Object), i = xe.toString, Ne = RegExp("^" + Me.call(q).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"), o = be ? n.Buffer : R, r = n.Symbol, Se = n.Uint8Array, Fe = ke(Object.getPrototypeOf, Object), Le = Object.create, Pe = xe.propertyIsEnumerable, Re = Ee.splice, be = Object.getOwnPropertySymbols, Ee = o ? o.isBuffer : R, Ie = ke(Object.keys, Object), $e = Math.max, o = p(n, "DataView"), a = p(n, "Map"), Ce = p(n, "Promise"), De = p(n, "Set"), n = p(n, "WeakMap"), u = p(Object, "create"), Ge = !Pe.call({ valueOf: 1 }, "valueOf"), Ue = y(o), ze = y(a), We = y(Ce), qe = y(De), Ve = y(n), r = r ? r.prototype : R, V = r ? r.valueOf : R, Xe = r ? r.toString : R; function s() { } function l(e) { var t = -1, n = e ? e.length : 0; for (this.clear(); ++t < n;) { var r = e[t]; this.set(r[0], r[1]) } } function c(e) { var t = -1, n = e ? e.length : 0; for (this.clear(); ++t < n;) { var r = e[t]; this.set(r[0], r[1]) } } function f(e) { var t = -1, n = e ? e.length : 0; for (this.clear(); ++t < n;) { var r = e[t]; this.set(r[0], r[1]) } } function He(e) { var t = -1, n = e ? e.length : 0; for (this.__data__ = new f; ++t < n;)this.add(e[t]) } function X(e) { this.__data__ = new c(e) } function Je(e, t) { var n, r = K(e) || v(e) ? function (e, t) { for (var n = -1, r = Array(e); ++n < e;)r[n] = t(n); return r }(e.length, String) : [], o = r.length, i = !!o; for (n in e) !t && !q.call(e, n) || i && ("length" == n || vt(n, o)) || r.push(n); return r } function Ke(e, t, n) { (n === R || J(e[t], n)) && ("number" != typeof t || n !== R || t in e) || (e[t] = n) } function Qe(e, t, n) { var r = e[t]; q.call(e, t) && J(r, n) && (n !== R || t in e) || (e[t] = n) } function Ye(e, t) { for (var n = e.length; n--;)if (J(e[n][0], t)) return n; return -1 } function m(n, r, o, i, e, t, a) { var u; if ((u = i ? t ? i(n, e, t, a) : i(n) : u) === R) { if (!Q(n)) return n; e = K(n); if (e) { if (u = function (e) { var t = e.length, n = e.constructor(t); t && "string" == typeof e[0] && q.call(e, "index") && (n.index = e.index, n.input = e.input); return n }(n), !r) return dt(n, u) } else { var s, l, c = H(n), f = c == w || c == j; if (Mt(n)) return s = n, (l = r) ? s.slice() : (l = new s.constructor(s.length), s.copy(l), l); if (c == G || c == C || f && !t) { if (W(n)) return t ? n : {}; if (u = "function" != typeof (s = f ? {} : n).constructor || wt(s) ? {} : function (e) { return Q(e) ? Le(e) : {} }(Fe(s)), !r) return f = l = n, f = (y = u) && gt(f, Z(f), y), gt(l, mt(l), f) } else { if (!d[c]) return t ? n : {}; u = function (e, t, n, r) { var o = e.constructor; switch (t) { case se: return yt(e); case te: case ne: return new o(+e); case z: return function (e, t) { t = t ? yt(e.buffer) : e.buffer; return new e.constructor(t, e.byteOffset, e.byteLength) }(e, r); case O: case E: case x: case T: case M: case B: case N: case S: case F: return function (e, t) { t = t ? yt(e.buffer) : e.buffer; return new e.constructor(t, e.byteOffset, e.length) }(e, r); case D: return function (e, t, n) { return je(t ? n(Ae(e), !0) : Ae(e), ve, new e.constructor) }(e, r, n); case oe: case ae: return new o(e); case ie: return function (e) { var t = new e.constructor(e.source, pe.exec(e)); return t.lastIndex = e.lastIndex, t }(e); case U: return function (e, t, n) { return je(t ? n(Oe(e), !0) : Oe(e), _e, new e.constructor) }(e, r, n); case ue: return function (e) { return V ? Object(V.call(e)) : {} }(e) } }(n, c, m, r) } } var p, y = (a = a || new X).get(n); if (y) return y; a.set(n, u), we((p = e ? p : o ? function (e, t, n) { t = t(e); return K(e) ? t : function (e, t) { for (var n = -1, r = t.length, o = e.length; ++n < r;)e[o + n] = t[n]; return e }(t, n(e)) }(n, Z, mt) : Z(n)) || n, function (e, t) { p && (e = n[t = e]), Qe(u, t, m(e, r, o, i, t, n, a)) }) } return u } l.prototype.clear = function () { this.__data__ = u ? u(null) : {} }, l.prototype.delete = function (e) { return this.has(e) && delete this.__data__[e] }, l.prototype.get = function (e) { var t, n = this.__data__; return u ? (t = n[e]) === h ? R : t : q.call(n, e) ? n[e] : R }, l.prototype.has = function (e) { var t = this.__data__; return u ? t[e] !== R : q.call(t, e) }, l.prototype.set = function (e, t) { return this.__data__[e] = u && t === R ? h : t, this }, c.prototype.clear = function () { this.__data__ = [] }, c.prototype.delete = function (e) { var t = this.__data__; return !((e = Ye(t, e)) < 0) && (e == t.length - 1 ? t.pop() : Re.call(t, e, 1), !0) }, c.prototype.get = function (e) { var t = this.__data__; return (e = Ye(t, e)) < 0 ? R : t[e][1] }, c.prototype.has = function (e) { return -1 < Ye(this.__data__, e) }, c.prototype.set = function (e, t) { var n = this.__data__, r = Ye(n, e); return r < 0 ? n.push([e, t]) : n[r][1] = t, this }, f.prototype.clear = function () { this.__data__ = { hash: new l, map: new (a || c), string: new l } }, f.prototype.delete = function (e) { return bt(this, e).delete(e) }, f.prototype.get = function (e) { return bt(this, e).get(e) }, f.prototype.has = function (e) { return bt(this, e).has(e) }, f.prototype.set = function (e, t) { return bt(this, e).set(e, t), this }, He.prototype.add = He.prototype.push = function (e) { return this.__data__.set(e, h), this }, He.prototype.has = function (e) { return this.__data__.has(e) }, X.prototype.clear = function () { this.__data__ = new c }, X.prototype.delete = function (e) { return this.__data__.delete(e) }, X.prototype.get = function (e) { return this.__data__.get(e) }, X.prototype.has = function (e) { return this.__data__.has(e) }, X.prototype.set = function (e, t) { var n = this.__data__; if (n instanceof c) { var r = n.__data__; if (!a || r.length < 199) return r.push([e, t]), this; n = this.__data__ = new f(r) } return n.set(e, t), this }; function Ze(e, t) { if (null != e) { if (!g(e)) return et(e, t); for (var n = e.length, r = tt ? n : -1, o = Object(e); (tt ? r-- : ++r < n) && !1 !== t(o[r], r, o);); } return e } et = function (e, t) { return e && rt(e, t, Z) }; var et, tt, nt, rt = function (e, t, n) { for (var r = -1, o = Object(e), i = n(e), a = i.length; a--;) { var u = i[nt ? a : ++r]; if (!1 === t(o[u], u, o)) break } return e }; function ot(e, t) { for (var n = 0, r = (t = _t(t, e) ? [t] : pt(t)).length; null != e && n < r;)e = e[Ot(t[n++])]; return n && n == r ? e : R } function it(e, t) { return null != e && t in Object(e) } function at(e, t, n, r, o) { if (e === t) return !0; if (null == e || null == t || !Q(e) && !Y(t)) return e != e && t != t; var i = at, a = K(e), u = K(t), s = ee, l = ee, u = (a || (s = (s = H(e)) == C ? G : s), u || (l = (l = H(t)) == C ? G : l), s == G && !W(e)), c = l == G && !W(t); if ((l = s == l) && !u) { o = o || new X; if (a || Pt(e)) return ht(e, t, i, n, r, o); else { var f = e; var p = t; var y = s; var d = i; var g = n; var h = r; var b = o; switch (y) { case z: if (f.byteLength != p.byteLength || f.byteOffset != p.byteOffset) return !1; f = f.buffer, p = p.buffer; case se: return f.byteLength == p.byteLength && d(new Se(f), new Se(p)) ? !0 : !1; case te: case ne: case oe: return J(+f, +p); case re: return f.name == p.name && f.message == p.message; case ie: case ae: return f == p + ""; case D: var m = Ae; case U: var v = h & $; if (m = m || Oe, f.size != p.size && !v) return !1; v = b.get(f); if (v) return v == p; h |= I, b.set(f, p); v = ht(m(f), m(p), d, g, h, b); return b.delete(f), v; case ue: if (V) return V.call(f) == V.call(p) }return !1; return } } if (!(r & $)) { var a = u && q.call(e, "__wrapped__"), s = c && q.call(t, "__wrapped__"); if (a || s) return u = a ? e.value() : e, c = s ? t.value() : t, o = o || new X, i(u, c, n, r, o) } if (l) { o = o || new X; var _ = e, w = t, j = i, A = n, k = r, O = o, E = k & $, x = Z(_), T = x.length, a = Z(w).length; if (T != a && !E) return !1; for (var M = T; M--;) { var B = x[M]; if (!(E ? B in w : q.call(w, B))) return !1 } if ((a = O.get(_)) && O.get(w)) return a == w; for (var N = !0, S = (O.set(_, w), O.set(w, _), E); ++M < T;) { B = x[M]; var F, L = _[B], P = w[B]; if (!((F = A ? E ? A(P, L, B, w, _, O) : A(L, P, B, _, w, O) : F) === R ? L === P || j(L, P, A, k, O) : F)) { N = !1; break } S = S || "constructor" == B } return N && !S && (a = _.constructor, s = w.constructor, a != s && "constructor" in _ && "constructor" in w && !("function" == typeof a && a instanceof a && "function" == typeof s && s instanceof s) && (N = !1)), O.delete(_), O.delete(w), N } return !1 } function ut(e) { var t; return Q(e) && (t = e, !(Te && Te in t)) && (Bt(e) || W(e) ? Ne : ye).test(y(e)) } function st(e) { if ("function" == typeof e) return e; if (null == e) return Ut; if ("object" == typeof e) if (K(e)) { var n = e[0], r = e[1]; return _t(n) && jt(r) ? At(Ot(n), r) : function (e) { var t = $t(e, n); return t === R && t === r ? Ct(e, n) : at(r, t, R, I | $) } } else { var t = e, o = function (e) { var t = Z(e), n = t.length; for (; n--;) { var r = t[n], o = e[r]; t[n] = [r, o, jt(o)] } return t }(t); return 1 == o.length && o[0][2] ? At(o[0][0], o[0][1]) : function (e) { return e === t || function (e, t, n, r) { var o = n.length, i = o, a = !r; if (null == e) return !i; for (e = Object(e); o--;) { var u = n[o]; if (a && u[2] ? u[1] !== e[u[0]] : !(u[0] in e)) return !1 } for (; ++o < i;) { var s = (u = n[o])[0], l = e[s], c = u[1]; if (a && u[2]) { if (l === R && !(s in e)) return !1 } else { var f, p = new X; if (!((f = r ? r(l, c, s, e, t, p) : f) === R ? at(c, l, r, I | $, p) : f)) return !1 } } return !0 }(e, t, o) } } return Wt(e) } function lt(e) { if (!Q(e)) { var t = e, n = []; if (null != t) for (var r in Object(t)) n.push(r); return n } var o, i = wt(e), a = []; for (o in e) ("constructor" != o || !i && q.call(e, o)) && a.push(o); return a } function ct(p, y, d, g, h) { var b; p !== y && we((b = K(y) || Pt(y) ? b : lt(y)) || y, function (e, t) { var n, r, o, i, a, u, s, l, c, f; Q(e = b ? y[t = e] : e) ? (h = h || new X, r = y, i = d, a = ct, u = g, s = h, l = (n = p)[o = t], c = r[o], (f = s.get(c)) ? Ke(n, o, f) : (f = u ? u(l, c, o + "", n, r, s) : R, (r = f === R) && (K(f = c) || Pt(c) ? f = K(l) ? l : Tt(l) ? dt(l) : m(c, !(r = !1)) : St(c) || v(c) ? f = v(l) ? Rt(l) : !Q(l) || i && Bt(l) ? m(c, !(r = !1)) : l : r = !1), r && (s.set(c, f), a(f, c, i, u, s), s.delete(c)), Ke(n, o, f))) : (l = g ? g(p[t], e, t + "", p, y, h) : R, Ke(p, t, l = l === R ? e : l)) }) } function ft(s, l) { return l = $e(l === R ? s.length - 1 : l, 0), function () { for (var e = arguments, t = -1, n = $e(e.length - l, 0), r = Array(n); ++t < n;)r[t] = e[l + t]; for (var t = -1, o = Array(l + 1); ++t < l;)o[t] = e[t]; o[l] = r; var i = s, a = this, u = o; switch (u.length) { case 0: return i.call(a); case 1: return i.call(a, u[0]); case 2: return i.call(a, u[0], u[1]); case 3: return i.call(a, u[0], u[1], u[2]) }return i.apply(a, u) } } function pt(e) { return K(e) ? e : kt(e) } function yt(e) { var t = new e.constructor(e.byteLength); return new Se(t).set(new Se(e)), t } function dt(e, t) { var n = -1, r = e.length; for (t = t || Array(r); ++n < r;)t[n] = e[n]; return t } function gt(e, t, n, r) { n = n || {}; for (var o = -1, i = t.length; ++o < i;) { var a = t[o], u = r ? r(n[a], e[a], a, n, e) : R; Qe(n, a, u === R ? e[a] : u) } return n } function ht(e, t, n, r, o, i) { var a = o & $, u = e.length, s = t.length; if (u != s && !(a && u < s)) return !1; s = i.get(e); if (s && i.get(t)) return s == t; var l = -1, c = !0, f = o & I ? new He : R; for (i.set(e, t), i.set(t, e); ++l < u;) { var p, y = e[l], d = t[l]; if ((p = r ? a ? r(d, y, l, t, e, i) : r(y, d, l, e, t, i) : p) !== R) { if (p) continue; c = !1; break } if (f) { if (!function (e, t) { for (var n = -1, r = e ? e.length : 0; ++n < r;)if (t(e[n], n, e)) return 1 }(t, function (e, t) { return !f.has(t) && (y === e || n(y, e, r, o, i)) && f.add(t) })) { c = !1; break } } else if (y !== d && !n(y, d, r, o, i)) { c = !1; break } } return i.delete(e), i.delete(t), c } function bt(e, t) { var n, r, e = e.__data__; return ("string" == (r = typeof (n = t)) || "number" == r || "symbol" == r || "boolean" == r ? "__proto__" !== n : null === n) ? e["string" == typeof t ? "string" : "hash"] : e.map } function p(e, t) { t = t; e = null == (e = e) ? R : e[t]; return ut(e) ? e : R } var mt = be ? ke(be, Object) : qt, H = function (e) { return i.call(e) }; function vt(e, t) { return !!(t = null == t ? _ : t) && ("number" == typeof e || de.test(e)) && -1 < e && e % 1 == 0 && e < t } function _t(e, t) { var n; if (!K(e)) return "number" == (n = typeof e) || "symbol" == n || "boolean" == n || null == e || Ft(e) || (P.test(e) || !L.test(e) || null != t && e in Object(t)) } function wt(e) { var t = e && e.constructor; return e === ("function" == typeof t && t.prototype || xe) } function jt(e) { return e == e && !Q(e) } function At(t, n) { return function (e) { return null != e && (e[t] === n && (n !== R || t in Object(e))) } } (o && H(new o(new ArrayBuffer(1))) != z || a && H(new a) != D || Ce && H(Ce.resolve()) != A || De && H(new De) != U || n && H(new n) != k) && (H = function (e) { var t = i.call(e), e = t == G ? e.constructor : R, e = e ? y(e) : R; if (e) switch (e) { case Ue: return z; case ze: return D; case We: return A; case qe: return U; case Ve: return k }return t }); var kt = xt(function (e) { e = It(e); var o = []; return le.test(e) && o.push(""), e.replace(ce, function (e, t, n, r) { o.push(n ? r.replace(fe, "$1") : t || e) }), o }); function Ot(e) { var t; return "string" == typeof e || Ft(e) ? e : "0" == (t = e + "") && 1 / e == -b ? "-0" : t } function y(e) { if (null != e) { try { return Me.call(e) } catch (e) { } try { return e + "" } catch (e) { } } return "" } function Et(e, t) { return (K(e) ? we : Ze)(e, function (e, t) { var n = (n = s.iteratee || zt) === zt ? st : n; return arguments.length ? n(e, t) : n }(t, 3)) } function xt(r, o) { if ("function" != typeof r || o && "function" != typeof o) throw new TypeError("Expected a function"); function i() { var e = arguments, t = o ? o.apply(this, e) : e[0], n = i.cache; return n.has(t) ? n.get(t) : (e = r.apply(this, e), i.cache = n.set(t, e), e) } return i.cache = new (xt.Cache || f), i } function J(e, t) { return e === t || e != e && t != t } function v(e) { return Tt(e) && q.call(e, "callee") && (!Pe.call(e, "callee") || i.call(e) == C) } xt.Cache = f; var K = Array.isArray; function g(e) { return null != e && Nt(e.length) && !Bt(e) } function Tt(e) { return Y(e) && g(e) } var Mt = Ee || Vt; function Bt(e) { e = Q(e) ? i.call(e) : ""; return e == w || e == j } function Nt(e) { return "number" == typeof e && -1 < e && e % 1 == 0 && e <= _ } function Q(e) { var t = typeof e; return !!e && ("object" == t || "function" == t) } function Y(e) { return !!e && "object" == typeof e } function St(e) { return !(!Y(e) || i.call(e) != G || W(e)) && (null === (e = Fe(e)) || "function" == typeof (e = q.call(e, "constructor") && e.constructor) && e instanceof e && Me.call(e) == Be) } function Ft(e) { return "symbol" == typeof e || Y(e) && i.call(e) == ue } var Lt, Pt = e ? (Lt = e, function (e) { return Lt(e) }) : function (e) { return Y(e) && Nt(e.length) && !!t[i.call(e)] }; function Rt(e) { return gt(e, Dt(e)) } function It(e) { return null == e ? "" : "string" == typeof (e = e) ? e : Ft(e) ? Xe ? Xe.call(e) : "" : "0" == (t = e + "") && 1 / e == -b ? "-0" : t; var t } function $t(e, t, n) { e = null == e ? R : ot(e, t); return e === R ? n : e } function Ct(e, t) { return null != e && function (e, t, n) { for (var r, o = -1, i = (t = _t(t, e) ? [t] : pt(t)).length; ++o < i;) { var a = Ot(t[o]); if (!(r = null != e && n(e, a))) break; e = e[a] } return r || !!(i = e ? e.length : 0) && Nt(i) && vt(a, i) && (K(e) || v(e)) }(e, t, it) } function Z(e) { return (g(e) ? Je : function (e) { if (!wt(e)) return Ie(e); var t, n = []; for (t in Object(e)) q.call(e, t) && "constructor" != t && n.push(t); return n })(e) } function Dt(e) { return g(e) ? Je(e, !0) : lt(e) } Gt = function (e, t, n) { ct(e, t, n) }; var Gt, r = ft(function (e, t) { var n = -1, r = t.length, o = 1 < r ? t[r - 1] : R, i = 2 < r ? t[2] : R, o = 3 < Gt.length && "function" == typeof o ? (r--, o) : R; for (i && function (e, t, n) { if (Q(n)) { var r = typeof t; if ("number" == r ? g(n) && vt(t, n.length) : "string" == r && t in n) return J(n[t], e) } return }(t[0], t[1], i) && (o = r < 3 ? R : o, r = 1), e = Object(e); ++n < r;) { var a = t[n]; a && Gt(e, a, n, o) } return e }); function Ut(e) { return e } function zt(e) { return st("function" == typeof e ? e : m(e, !0)) } function Wt(e) { return _t(e) ? (n = Ot(e), function (e) { return null == e ? R : e[n] }) : (t = e, function (e) { return ot(e, t) }); var t, n } function qt() { return [] } function Vt() { return !1 } s.compact = function (e) { for (var t = -1, n = e ? e.length : 0, r = 0, o = []; ++t < n;) { var i = e[t]; i && (o[r++] = i) } return o }, s.iteratee = zt, s.keys = Z, s.keysIn = Dt, s.memoize = xt, s.merge = r, s.property = Wt, s.toPlainObject = Rt, s.clone = function (e) { return m(e, !1, !0) }, s.eq = J, s.forEach = Et, s.get = $t, s.hasIn = Ct, s.identity = Ut, s.isArguments = v, s.isArray = K, s.isArrayLike = g, s.isArrayLikeObject = Tt, s.isBuffer = Mt, s.isEmpty = function (e) { if (g(e) && (K(e) || "string" == typeof e || "function" == typeof e.splice || Mt(e) || v(e))) return !e.length; var t, n = H(e); if (n == D || n == U) return !e.size; if (Ge || wt(e)) return !Ie(e).length; for (t in e) if (q.call(e, t)) return !1; return !0 }, s.isFunction = Bt, s.isLength = Nt, s.isObject = Q, s.isObjectLike = Y, s.isPlainObject = St, s.isSymbol = Ft, s.isTypedArray = Pt, s.stubArray = qt, s.stubFalse = Vt, s.toString = It, s.each = Et, s.VERSION = "4.15.0", he && ((he.exports = s)._ = s, ge._ = s) }.call(this) }.call(this) }.call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}) }, {}], 3: [function (e, t, n) { function i(e, t) { if (0 !== e.length) { r(e[0], t); for (var n = 1; n < e.length; n++)r(e[n], !t) } } function r(e, t) { for (var n = 0, r = 0, o = 0, i = e.length, a = i - 1; o < i; a = o++) { var u = (e[o][0] - e[a][0]) * (e[a][1] + e[o][1]), s = n + u; r += Math.abs(n) >= Math.abs(u) ? n - s + u : u - s + n, n = s } 0 <= n + r != !!t && e.reverse() } t.exports = function e(t, n) { var r, o = t && t.type; if ("FeatureCollection" === o) for (r = 0; r < t.features.length; r++)e(t.features[r], n); else if ("GeometryCollection" === o) for (r = 0; r < t.geometries.length; r++)e(t.geometries[r], n); else if ("Feature" === o) e(t.geometry, n); else if ("Polygon" === o) i(t.coordinates, n); else if ("MultiPolygon" === o) for (r = 0; r < t.coordinates.length; r++)i(t.coordinates[r], n); return t } }, {}], 4: [function (e, t, n) { t.exports = e("./polygon-features.json") }, { "./polygon-features.json": 5 }], 5: [function (e, t, n) { t.exports = [{ key: "building", polygon: "all" }, { key: "highway", polygon: "whitelist", values: ["services", "rest_area", "escape", "elevator"] }, { key: "natural", polygon: "blacklist", values: ["coastline", "cliff", "ridge", "arete", "tree_row"] }, { key: "landuse", polygon: "all" }, { key: "waterway", polygon: "whitelist", values: ["riverbank", "dock", "boatyard", "dam"] }, { key: "amenity", polygon: "all" }, { key: "leisure", polygon: "all" }, { key: "barrier", polygon: "whitelist", values: ["city_wall", "ditch", "hedge", "retaining_wall", "wall", "spikes"] }, { key: "railway", polygon: "whitelist", values: ["station", "turntable", "roundhouse", "platform"] }, { key: "area", polygon: "all" }, { key: "boundary", polygon: "all" }, { key: "man_made", polygon: "blacklist", values: ["cutline", "embankment", "pipeline"] }, { key: "power", polygon: "whitelist", values: ["plant", "substation", "generator", "transformer"] }, { key: "place", polygon: "all" }, { key: "shop", polygon: "all" }, { key: "aeroway", polygon: "blacklist", values: ["taxiway"] }, { key: "tourism", polygon: "all" }, { key: "historic", polygon: "all" }, { key: "public_transport", polygon: "all" }, { key: "office", polygon: "all" }, { key: "building:part", polygon: "all" }, { key: "military", polygon: "all" }, { key: "ruins", polygon: "all" }, { key: "area:highway", polygon: "all" }, { key: "craft", polygon: "all" }, { key: "golf", polygon: "all" }, { key: "indoor", polygon: "all" }] }, {}] }, {}, [1])(1) });