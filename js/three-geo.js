
      AFRAME.registerComponent('three-geo', {
        schema: {
         token: {type: 'string', default: '*******'},
          lat: {type: 'number', default: 35.3778},
          lng: {type: 'number', default: 138.7472},
          radius: {type: 'number', default: 5.0},
          zoom: {type: 'number', default: 13},
          axes_on: {type: 'boolean', default: true},
      },

      init: function () {
          geoScene = this.el.object3D;

          if (this.data.axes_on){
            const walls = new THREE.LineSegments(
                new THREE.EdgesGeometry(new THREE.BoxBufferGeometry(1, 1, 1)),
                new THREE.LineBasicMaterial({color: 0xcccccc}));
            walls.position.set(0, 0, 0);
            geoScene.add(walls);
            geoScene.add(new THREE.AxesHelper(1));
          }

          const tgeo = new ThreeGeo({
              tokenMapbox: this.data.token, // <---- set your Mapbox API token here
          });

          if (tgeo.tokenMapbox === '********') {
              alert('Please provide your Mapbox API token with the ThreeGeo constructor.');
          } else {
              // params: [lat, lng], terrain's radius (km), zoom resolution, callbacks
              // Beware the value of radius; radius > 5.0 (km) could trigger huge number of tile API calls!!
              tgeo.getTerrain([this.data.lat, this.data.lng], this.data.radius, this.data.zoom, {
                  onRgbDem: (meshes) => { // your implementation when terrain's geometry is obtained'
                      console.log('obtained meshes...');
                      console.log('meshes: ', meshes);
                      meshes.forEach((mesh) => { geoScene.add(mesh); });
                  },
                  onSatelliteMat: (mesh) => { // your implementation when terrain's satellite texture is obtained
                    console.log("satellite is done!!!");
                    // include in schema: +          spinner: {type: 'selector'},
                    // this.data.spinner.setAttribute("style", "display: none;");
                    // this.data.spinner.style.display = "none";
                    // document.getElementById("cover-spin").style.display = "none";

                  },
              });
          }
      }
      });
