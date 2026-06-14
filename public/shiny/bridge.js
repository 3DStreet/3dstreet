/*
 * 3DStreet <-> Shiny bridge shim
 * ------------------------------
 * Include this script inside a (same-origin) Shiny app that is embedded in the
 * 3DStreet editor, e.g. a `shinylive` static export:
 *
 *   tags$head(tags$script(src = "bridge.js"))
 *
 * It does two things:
 *
 *  1. host -> app: listens for 3DStreet "set-input" messages (fired when the
 *     user clicks the map in the 3D scene) and forwards them to Shiny as the
 *     canonical Leaflet inputs, e.g. input$map_click, input$map_shape_click.
 *     Your server code observes these exactly as it would with a real Leaflet
 *     map -- no changes required.
 *
 *  2. app -> host: forwards the map's render instructions to 3DStreet so the
 *     geographic features are drawn in the 3D scene instead of a 2D Leaflet
 *     map. The reliable path is the explicit API `Shiny3DStreet.sendFeatures`.
 *     A best-effort auto-hook for canonical `renderLeaflet` output is also
 *     provided (see hookLeaflet below).
 *
 * Protocol (all messages tagged with __shiny3dstreet):
 *   app  -> host : { dir:'app->host', type:'ready'|'features'|'clear', mapId, geojson? }
 *   host -> app  : { dir:'host->app', type:'set-input', mapId, name, value }
 */
(function () {
  'use strict';

  var DEFAULT_MAP_ID = 'map';

  function post(payload) {
    payload.__shiny3dstreet = true;
    payload.dir = 'app->host';
    // The parent is the 3DStreet editor window hosting this iframe.
    window.parent.postMessage(payload, '*');
  }

  function setShinyInput(name, value) {
    if (window.Shiny && typeof window.Shiny.setInputValue === 'function') {
      window.Shiny.setInputValue(name, value, { priority: 'event' });
    } else {
      // Shiny not ready yet (or a non-Shiny test harness): expose for debugging.
      console.log('[shiny-bridge] setInputValue', name, value);
    }
  }

  // --- host -> app ---------------------------------------------------------

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || msg.__shiny3dstreet !== true || msg.dir !== 'host->app') {
      return;
    }
    if (msg.type === 'set-input' && msg.name) {
      setShinyInput(msg.name, msg.value);
    }
  });

  // --- app -> host : explicit API ------------------------------------------

  var api = {
    // Push a GeoJSON FeatureCollection to the 3D scene for the given map output.
    sendFeatures: function (geojson, opts) {
      opts = opts || {};
      post({
        type: 'features',
        mapId: opts.mapId || DEFAULT_MAP_ID,
        geojson: typeof geojson === 'string' ? JSON.parse(geojson) : geojson
      });
    },
    clear: function (mapId) {
      post({ type: 'clear', mapId: mapId || DEFAULT_MAP_ID });
    },
    ready: function (mapId) {
      post({ type: 'ready', mapId: mapId || DEFAULT_MAP_ID });
    }
  };
  window.Shiny3DStreet = api;

  // --- app -> host : best-effort canonical renderLeaflet auto-hook ---------
  //
  // Leaflet htmlwidgets deliver their drawing instructions as `x.calls`, a list
  // of { method, args }. We hook the leaflet output binding's renderValue,
  // translate the polyline/polygon calls into GeoJSON, and forward them. This
  // lets an author keep 100% canonical `leafletOutput`/`renderLeaflet`. It is
  // best-effort: leaflet's arg packing varies by version, so when a call can't
  // be parsed we log and skip rather than guess. Use sendFeatures for full
  // control.
  function callsToGeoJSON(calls, mapId) {
    var features = [];

    function pushLineStrings(latArr, lngArr, color) {
      // Leaflet flattens multiple polylines into one lat/lng array separated by
      // null/NA. Split on null to recover individual lines.
      var line = [];
      var n = Math.min(latArr.length, lngArr.length);
      for (var i = 0; i < n; i++) {
        var lat = latArr[i];
        var lng = lngArr[i];
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
          if (line.length > 1) {
            features.push(lineFeature(line, color));
          }
          line = [];
          continue;
        }
        line.push([lng, lat]);
      }
      if (line.length > 1) {
        features.push(lineFeature(line, color));
      }
    }

    function lineFeature(coords, color) {
      return {
        type: 'Feature',
        properties: color ? { color: color } : {},
        geometry: { type: 'LineString', coordinates: coords }
      };
    }

    (calls || []).forEach(function (call) {
      var method = call.method;
      var args = call.args || [];
      if (method !== 'addPolylines' && method !== 'addPolygons') {
        return;
      }
      // Common shapes: args[0] = {lat:[], lng:[]}  OR  args[0]=lat, args[1]=lng.
      var lat;
      var lng;
      var color;
      if (args[0] && args[0].lat && args[0].lng) {
        lat = args[0].lat;
        lng = args[0].lng;
      } else if (Array.isArray(args[0]) && Array.isArray(args[1])) {
        lat = args[0];
        lng = args[1];
      } else {
        console.log('[shiny-bridge] could not parse leaflet call', method, args);
        return;
      }
      // options object often carries a `color`
      var optsArg = args.find(function (a) {
        return a && typeof a === 'object' && !Array.isArray(a) && a.color;
      });
      if (optsArg) {
        color = Array.isArray(optsArg.color) ? optsArg.color[0] : optsArg.color;
      }
      pushLineStrings(lat, lng, color);
    });

    if (!features.length) {
      return null;
    }
    return {
      mapId: mapId,
      geojson: { type: 'FeatureCollection', features: features }
    };
  }

  function hookLeaflet() {
    if (!window.HTMLWidgets || !window.HTMLWidgets.widgets) {
      return false;
    }
    var binding = window.HTMLWidgets.widgets.find(function (w) {
      return w.name === 'leaflet';
    });
    if (!binding || binding.__shiny3dstreetHooked) {
      return !!binding;
    }
    var originalRender = binding.renderValue;
    binding.renderValue = function (el, x, instance) {
      try {
        var mapId = (el && el.id) || DEFAULT_MAP_ID;
        var parsed = callsToGeoJSON(x && x.calls, mapId);
        if (parsed) {
          post({ type: 'features', mapId: parsed.mapId, geojson: parsed.geojson });
          // Hide the 2D map container since the 3D scene is now the map.
          if (el) {
            el.style.display = 'none';
          }
        }
      } catch (e) {
        console.log('[shiny-bridge] leaflet hook failed', e);
      }
      return originalRender.apply(this, arguments);
    };
    binding.__shiny3dstreetHooked = true;
    return true;
  }

  // HTMLWidgets may register after we load; retry briefly.
  var tries = 0;
  var poll = setInterval(function () {
    if (hookLeaflet() || ++tries > 40) {
      clearInterval(poll);
    }
  }, 250);

  api.ready();
})();
