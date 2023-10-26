/* global AFRAME, customElements */

function buildAssetHTML (assetUrl, categories) {
  if (!assetUrl) assetUrl = 'https://assets.3dstreet.app/';
  console.log('[street]', 'Using street assets from', assetUrl);
  var assetsObj = {
    'sidewalk-props': `
        <!-- sidewalk props -->
        <img id="wayfinding-map" src="${assetUrl}objects/wayfinding.jpg" crossorigin="anonymous" />
        <a-asset-item id="streetProps" src="${assetUrl}sets/street-props/gltf-exports/draco/street-props.glb"></a-asset-item>
        <a-asset-item id="brt-station-model" src="${assetUrl}sets/brt-station/gltf-exports/draco/brt-station.glb"></a-asset-item>
        <a-mixin id="brt-station" gltf-model="#brt-station-model" ></a-mixin>
        <a-mixin id="outdoor_dining" gltf-part="src: #streetProps; part: outdoor_dining"></a-mixin>
        <a-mixin id="bench_orientation_center" gltf-part="src: #streetProps; part: bench_orientation_center"></a-mixin>
        <a-mixin id="parklet" gltf-part="src: #streetProps; part: parklet"></a-mixin>
        <a-mixin id="utility_pole" gltf-part="src: #streetProps; part: utility_pole"></a-mixin>
        <a-mixin id="lamp-modern" gltf-part="src: #streetProps; part: street-light"></a-mixin>
        <a-mixin id="lamp-modern-double" gltf-part="src: #streetProps; part: street-light-double"></a-mixin>
        <a-mixin id="bikerack" gltf-part="src: #streetProps; part: bike_rack"></a-mixin>
        <a-mixin id="bikeshare" gltf-part="src: #streetProps; part: bike_share"></a-mixin>
        <a-mixin id="lamp-traditional" gltf-part="src: #streetProps; part: lamp_post_traditional" scale="2 2 2"></a-mixin>
        <a-mixin id="palm-tree" gltf-part="src: #streetProps; part: palmtree" scale="1 1.5 1"></a-mixin>
        <a-mixin id="bench" gltf-part="src: #streetProps; part: park_bench"></a-mixin>
        <a-mixin id="seawall" gltf-part="src: #streetProps; part: sea_wall"></a-mixin>
        <a-mixin id="track" gltf-part="src: #streetProps; part: track"></a-mixin>
        <a-mixin id="tree3" gltf-part="src: #streetProps; part: tree-01" scale="1.25 1.25 1.25"></a-mixin>
        <a-mixin id="bus-stop" gltf-part="src: #streetProps; part: transit-shelter-1"></a-mixin>
        <a-mixin id="pride-flag" position="0.409 3.345 0" rotation="0 0 0" scale="0.5 0.75 0" geometry="width:2;height:2;primitive:plane" material="side:double; src:${assetUrl}materials/rainbow-flag-poles_512.png;transparent: true;"></a-mixin>
        <a-mixin id="wayfinding-box" geometry="primitive: box; height: 2; width: 0.84; depth: 0.1" material="color: gray"></a-mixin>
      `,
    people: `
        <!-- human characters -->
        <a-asset-item id="humans" src="${assetUrl}sets/human-characters-poses-1/gltf-exports/draco/human-characters-poses-1.glb"></a-asset-item>
        <a-mixin id="char1" gltf-part="src: #humans; part: Character_1"></a-mixin>
        <a-mixin id="char2" gltf-part="src: #humans; part: Character_2"></a-mixin>
        <a-mixin id="char3" gltf-part="src: #humans; part: Character_3"></a-mixin>
        <a-mixin id="char4" gltf-part="src: #humans; part: Character_4"></a-mixin>
        <a-mixin id="char5" gltf-part="src: #humans; part: Character_5"></a-mixin>
        <a-mixin id="char6" gltf-part="src: #humans; part: Character_6"></a-mixin>
        <a-mixin id="char7" gltf-part="src: #humans; part: Character_7"></a-mixin>
        <a-mixin id="char8" gltf-part="src: #humans; part: Character_8"></a-mixin>
        <a-asset-item id="humans2" src="${assetUrl}sets/human-characters-poses-2/gltf-exports/draco/human-characters-poses-2.glb"></a-asset-item>
        <a-mixin id="char9" gltf-part="src: #humans2; part: Character_9"></a-mixin>
        <a-mixin id="char10" gltf-part="src: #humans2; part: Character_10"></a-mixin>
        <a-mixin id="char11" gltf-part="src: #humans2; part: Character_11"></a-mixin>
        <a-mixin id="char12" gltf-part="src: #humans2; part: Character_12"></a-mixin>
        <a-mixin id="char13" gltf-part="src: #humans2; part: Character_13"></a-mixin>
        <a-mixin id="char14" gltf-part="src: #humans2; part: Character_14"></a-mixin>
        <a-mixin id="char15" gltf-part="src: #humans2; part: Character_15"></a-mixin>
        <a-mixin id="char16" gltf-part="src: #humans2; part: Character_16"></a-mixin>
      `,
    'people-rigged': `          
        <a-asset-item id="character1walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-1-walk.glb"></a-asset-item>
        <a-mixin id="a_char1" gltf-model="#character1walk" animation-mixer></a-mixin>
        
        <a-asset-item id="character2walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-2-walk.glb"></a-asset-item>
        <a-mixin id="a_char2" gltf-model="#character2walk" animation-mixer></a-mixin>
        <a-asset-item id="character3walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-3-walk.glb"></a-asset-item>
        <a-mixin id="a_char3" gltf-model="#character3walk" animation-mixer></a-mixin>
        <a-asset-item id="character4walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-4-walk.glb"></a-asset-item>
        <a-mixin id="a_char4" gltf-model="#character4walk" animation-mixer></a-mixin>
        <a-asset-item id="character5walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-5-walk.glb"></a-asset-item>
        <a-mixin id="a_char5" gltf-model="#character5walk" animation-mixer></a-mixin>
        <a-asset-item id="character6walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-6-walk.glb"></a-asset-item>
        <a-mixin id="a_char6" gltf-model="#character6walk" animation-mixer></a-mixin>
        <a-asset-item id="character7walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-7-walk.glb"></a-asset-item>
        <a-mixin id="a_char7" gltf-model="#character7walk" animation-mixer></a-mixin>
        <a-asset-item id="character8walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-8-walk.glb"></a-asset-item>
        <a-mixin id="a_char8" gltf-model="#character8walk" animation-mixer></a-mixin>
      `,
    vehicles: `
        <!-- vehicles -->
        <a-asset-item id="magic-carpet-glb" src="${assetUrl}sets/magic-carpet/gltf-exports/draco/magic-carpet.glb"></a-asset-item>
        <a-mixin id="Character_1_M" gltf-part="src: #magic-carpet-glb; part: Character_1_M"></a-mixin>
        <a-mixin id="magic-carpet" gltf-part="src: #magic-carpet-glb; part: magic-carpet"></a-mixin>
        <!-- micro mobility vehicles -->
        <a-asset-item id="microMobilityDevices" src="${assetUrl}sets/micro-mobility-devices/gltf-exports/draco/micro-mobility-devices_v01.glb"></a-asset-item>
        <a-mixin id="Bicycle_1" gltf-part="src: #microMobilityDevices; part: Bicycle_1"></a-mixin>
        <a-mixin id="ElectricScooter_1" gltf-part="src: #microMobilityDevices; part: ElectricScooter_1"></a-mixin>
      `,
    'vehicles-rigged': `
        <!-- vehicles rigged -->
        <a-mixin id="sedan-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/toyota-prius-rig.glb)" ></a-mixin>
        <a-mixin id="sedan-taxi-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/sedan-taxi-rig.glb)"></a-mixin>
        <a-mixin id="suv-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/suv-rig.glb)"></a-mixin>
        <a-mixin id="box-truck-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/isuzu-truck-rig.glb)"></a-mixin>
        <a-mixin id="food-trailer-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/food-trailer-rig.glb)"></a-mixin>
        <a-mixin id="fire-truck-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/fire-truck-pumper-rig.glb)"></a-mixin>
        <a-mixin id="self-driving-cruise-car-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/self-driving-cruise-car-rig.glb)"></a-mixin>
      `,
    buildings: `
        <!-- blocks -->
        <a-asset-item id="blockmodel" src="${assetUrl}sets/buildings/gltf-exports/draco/buildings.glb"></a-asset-item>
        <a-asset-item id="archedmodel" src="${assetUrl}sets/arcade-style-buildings/gltf-exports/draco/arched-buildings.glb"></a-asset-item>
        <a-asset-item id="suburbiamodel" src="${assetUrl}sets/suburban-houses/gltf-exports/draco/suburban-houses.glb"></a-asset-item>

        <!-- buildings and blocks -->
        <a-mixin id="SM3D_Bld_Mixed_Corner_4fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_Corner_4fl"></a-mixin>
        <a-mixin id="SM3D_Bld_Mixed_Double_5fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_Double_5fl"></a-mixin>
        <a-mixin id="SM3D_Bld_Mixed_4fl_2" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_4fl_2"></a-mixin>
        <a-mixin id="SM3D_Bld_Mixed_5fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_5fl"></a-mixin>
        <a-mixin id="SM3D_Bld_Mixed_4fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_4fl"></a-mixin>

        <!-- suburban buildings -->
        <a-mixin id="SM_Bld_House_Preset_03_1800" scale="1 1 1" rotation="0 0 0" gltf-part="src: #suburbiamodel; part: suburban-house_1"></a-mixin>
        <a-mixin id="SM_Bld_House_Preset_08_1809" scale="1 1 1" rotation="0 0 0" gltf-part="src: #suburbiamodel; part: suburban-house_3"></a-mixin>
        <a-mixin id="SM_Bld_House_Preset_09_1845" scale="1 1 1" rotation="0 0 0" gltf-part="src: #suburbiamodel; part: suburban-house_2"></a-mixin>

        <!-- arched style buildings -->
        <a-mixin id="arched-building-01" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-01"></a-mixin>
        <a-mixin id="arched-building-02" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-02"></a-mixin>
        <a-mixin id="arched-building-03" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-03"></a-mixin>
        <a-mixin id="arched-building-04" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-04"></a-mixin>
`,
    'intersection-props': `
        <a-asset-item id="stopsign" src="${assetUrl}sets/road-signs/gltf-exports/draco/stop-sign.glb"></a-asset-item>
        <a-asset-item id="signal1" src="${assetUrl}sets/signals/gltf-exports/draco/signal1.glb"></a-asset-item>
        <a-asset-item id="signal2" src="${assetUrl}sets/signals/gltf-exports/draco/signal2.glb"></a-asset-item>
        <a-mixin id="signal_left" gltf-model="#signal1"></a-mixin>
        <a-mixin id="signal_right" gltf-model="#signal2"></a-mixin>
        <a-mixin id="stop_sign" gltf-model="#stopsign"></a-mixin>
      `,
    'segment-textures': `  
        <!-- segment mixins with textures -->
        <img id="seamless-road" src="${assetUrl}materials/TexturesCom_Roads0086_1_seamless_S_rotate.jpg" crossorigin="anonymous">
        <img id="seamless-bright-road" src="${assetUrl}materials/asphalthd_Base_Color.jpg" crossorigin="anonymous">
        <img id="hatched-base" src="${assetUrl}materials/hatched_Base_Color.jpg" crossorigin="anonymous">
        <img id="hatched-normal" src="${assetUrl}materials/hatched_Normal.jpg" crossorigin="anonymous">
        <img id="seamless-sidewalk" src="${assetUrl}materials/TexturesCom_FloorsRegular0301_1_seamless_S.jpg" crossorigin="anonymous">
        <a-mixin id="drive-lane" geometry="width:3;height:150;primitive:plane" material="repeat:0.3 25;offset:0.55 0;src:#seamless-road;"></a-mixin>
        <a-mixin id="bright-lane" geometry="width:3;height:150;primitive:plane" material="repeat:0.6 50;offset:0.55 0;src:#seamless-bright-road;color:#dddddd"></a-mixin>
        <a-mixin id="bike-lane" geometry="width:1.8;height:150;primitive:plane" material="repeat:0.3 25;offset:0.55 0;roughness:1;metalness:0;src:#seamless-road;"></a-mixin>
        <a-mixin id="sidewalk" anisotropy geometry="width:3;height:150;primitive:plane" material="repeat:1.5 75;src:#seamless-sidewalk;"></a-mixin>
        <a-mixin id="bus-lane" geometry="width:3;height:150;primitive:plane" material="repeat:0.3 25;offset:0.55 0;src:#seamless-road;"></a-mixin>
        <a-mixin id="divider" geometry="width:0.3;height:150;primitive:plane" material="repeat:1 150;offset:0.415 0;normalTextureOffset:0.415 0;src:#hatched-base;normalTextureRepeat:0.21 150;normalMap:#hatched-normal"></a-mixin>
        <a-mixin id="grass" geometry="width:0.3;height:150;primitive:plane" material="repeat:1 150;offset:0.415 0;src:#grass-texture;"></a-mixin>
      `,
    'segment-colors': `  
        <!-- segment color modifier mixins -->
        <a-mixin id="yellow" material="color:#f7d117"></a-mixin>
        <a-mixin id="surface-green" material="color:#adff83"></a-mixin>
        <a-mixin id="surface-red" material="color:#ff9393"></a-mixin>
      `,
    'lane-separator': `
        <!-- lane separator markings -->
        <img id="markings-atlas" src="${assetUrl}materials/lane-markings-atlas_1024.png" crossorigin="anonymous" /> 
        <a-mixin id="markings" anisotropy atlas-uvs="totalRows: 1; totalColumns: 8; row: 1" scale="1 1 1" material="src: #markings-atlas;alphaTest: 0;transparent:true;repeat:1 25;" geometry="primitive: plane; buffer: false; skipCache: true; width:0.2; height:150;"></a-mixin>
        <a-mixin id="solid-stripe" atlas-uvs="column: 3; row: 1" material="repeat:1 5;"></a-mixin>
        <a-mixin id="dashed-stripe" atlas-uvs="column: 4; row: 1"></a-mixin>
        <a-mixin id="short-dashed-stripe" atlas-uvs="column: 4" material="repeat:1 50;"></a-mixin>
        <a-mixin id="solid-doubleyellow" atlas-uvs="totalColumns: 4; column: 3" geometry="width: 0.5"></a-mixin>
        <a-mixin id="solid-dashed" atlas-uvs="totalColumns: 4; column: 2" geometry="width: 0.4"></a-mixin>
        <a-mixin id="crosswalk-zebra" atlas-uvs="totalColumns: 4; column: 4" geometry="width: 2; height: 12"  material="repeat: 1 2"></a-mixin>
      `,
    stencils: `  
        <!-- stencil markings -->
        <img id="stencils-atlas" src="${assetUrl}materials/stencils-atlas_2048.png" crossorigin="anonymous" />
        <a-mixin id="stencils" anisotropy atlas-uvs="totalRows: 4; totalColumns: 4" scale="2 2 2" material="src: #stencils-atlas;alphaTest: 0;transparent:true;" geometry="primitive: plane; buffer: false; skipCache: true;"></a-mixin>
        <a-mixin id="right" atlas-uvs="column: 3; row: 2"></a-mixin>
        <a-mixin id="left" atlas-uvs="column: 3; row: 3"></a-mixin>
        <a-mixin id="both" atlas-uvs="column: 2; row: 1"></a-mixin>
        <a-mixin id="all" atlas-uvs="column: 3; row: 1"></a-mixin>
        <a-mixin id="left-straight" atlas-uvs="column: 2; row: 3"></a-mixin>
        <a-mixin id="right-straight" atlas-uvs="column: 2; row: 2"></a-mixin>
        <a-mixin id="straight" atlas-uvs="column: 2; row: 4"></a-mixin>
        <a-mixin id="sharrow" atlas-uvs="totalRows: 4; totalColumns: 8; column: 2; row: 3" scale="1.5 3 1"></a-mixin>
        <a-mixin id="bike-arrow" atlas-uvs="totalRows: 2; totalColumns: 8; column: 1; row: 2" scale="1 4 1"></a-mixin>
        <a-mixin id="word-bus" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 4" scale="3 3 3"></a-mixin>
        <a-mixin id="word-lane" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 4" scale="3 3 3"></a-mixin>
        <a-mixin id="word-taxi" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 3" scale="3 3 3"></a-mixin>
        <a-mixin id="word-only" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 3" scale="3 3 3"></a-mixin>
        <a-mixin id="word-only-small" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 3" scale="2.5 2 2.5"></a-mixin>
        <a-mixin id="word-yield" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 2" scale="3 3 3"></a-mixin>
        <a-mixin id="word-slow" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 2" scale="3 3 3"></a-mixin>
        <a-mixin id="word-xing" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 1" scale="3 3 3"></a-mixin>
        <a-mixin id="word-stop" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 1" scale="3 3 3"></a-mixin>
        <a-mixin id="word-loading-small" atlas-uvs="totalRows: 8; totalColumns: 4; column: 4; row: 1" scale="2.75 1.75 2.75"></a-mixin>
        <a-mixin id="perpendicular-stalls" atlas-uvs="totalRows: 4; totalColumns: 8; column: 5; row: 4" scale="5 10 5"></a-mixin>
        <a-mixin id="parking-t" atlas-uvs="totalRows: 8; totalColumns: 16; column: 4; row: 7" scale="1.5 2 2"></a-mixin>
        <a-mixin id="painted-safety-zone" atlas-uvs="totalRows: 4; totalColumns: 4; column: 4; row: 4" scale="8 8 8"></a-mixin>
      `,
    'vehicles-transit': `
        <!-- vehicles-transit -->
        <a-asset-item id="trammodel" src="${assetUrl}sets/light-rail-vehicle/gltf-exports/draco/light-rail-vehicle-v02.glb"></a-asset-item>
        <a-asset-item id="trolleymodel" src="${assetUrl}objects/godarvilletram.gltf"></a-asset-item>
        <a-asset-item id="xd40" src="${assetUrl}sets/flyer-bus/gltf-exports/draco/new-flyer-bus.glb"></a-asset-item>
        <a-mixin id="bus" anisotropy gltf-model="#xd40"></a-mixin>
        <a-mixin id="tram" anisotropy gltf-model="#trammodel"></a-mixin>
        <a-mixin id="trolley" gltf-model="#trolleymodel"></a-mixin>
      `,
    dividers: `
        <!-- dividers -->
        <a-asset-item id="dividers" src="${assetUrl}sets/dividers/gltf-exports/draco/dividers.glb"></a-asset-item>        
        <a-mixin id="dividers-flowers" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: flowers"></a-mixin>
        <a-mixin id="dividers-planting-strip" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: planting-strip"></a-mixin>
        <a-mixin id="dividers-planter-box" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: planter-box"></a-mixin>
        <a-mixin id="dividers-bush" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: bush"></a-mixin>
        <a-mixin id="dividers-dome" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: dome"></a-mixin>
        <a-mixin id="safehit" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: bollard"></a-mixin>
        <a-mixin id="temporary-barricade" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: barricade"></a-mixin>
        <a-mixin id="temporary-traffic-cone" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: traffic-cone"></a-mixin>
        <a-mixin id="temporary-jersey-barrier-plastic" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: jersey-barrier-plastic"></a-mixin>
        <a-mixin id="temporary-jersey-barrier-concrete" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: jersey-barrier-concrete"></a-mixin>
      `,
    sky: `
        <!-- sky -->
        <img id="sky" src="${assetUrl}CGSkies_0343_doubled_2048.jpg" crossorigin="anonymous" />
        <img id="sky-night" src="${assetUrl}images/AdobeStock_286725174-min.jpeg" crossorigin="anonymous" />
      `,
    grounds: `
        <!-- grounds -->
        <img id="grass-texture" src="${assetUrl}materials/TexturesCom_Grass0052_1_seamless_S.jpg" crossorigin="anonymous">
        <img id="parking-lot-texture" src="${assetUrl}materials/TexturesCom_Roads0111_1_seamless_S.jpg" crossorigin="anonymous">
        <img id="asphalt-texture" src="${assetUrl}materials/TexturesCom_AsphaltDamaged0057_1_seamless_S.jpg" crossorigin="anonymous">

        <a-mixin id="ground-grass" rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#grass-texture;repeat:5 5;roughness:1"></a-mixin>
        <a-mixin id="ground-parking-lot" rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#parking-lot-texture;repeat:2 4;roughness:1"></a-mixin>
        <a-mixin id="ground-asphalt" rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#asphalt-texture;repeat:5 5;roughness:1"></a-mixin>
        <a-mixin id="ground-tiled-concrete" anisotropy rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#seamless-sidewalk;repeat:5 5;roughness:1"></a-mixin>

        <a-asset-item id="fence-model" src="${assetUrl}sets/fences/gltf-exports/draco/fence4.glb"></a-asset-item>
        <a-mixin id="fence" gltf-model="#fence-model" scale="0.1 0.1 0.1"></a-mixin>
      `,
    'loud-bicycle': `
        <!-- loud-bicycle-game -->
        <a-mixin id="cyclist-cargo" gltf-model="url(${assetUrl}sets/cargo-bike-animation/gltf-exports/draco/cargo_bike_animation_v1.glb)"></a-mixin>
        <a-mixin id="cyclist1" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/cyclist-1-animation-v1.glb)"></a-mixin>
        <a-mixin id="cyclist2" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/cyclist-2-animation-v1.glb)"></a-mixin>
        <a-mixin id="cyclist3" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/cyclist-3-animation-v1.glb)"></a-mixin>
        <a-mixin id="cyclist-kid" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/Kid_cyclist_animation_v01.glb)"></a-mixin>
        <a-mixin id="cyclist-dutch" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/Dutch_cyclist_animation_v01.glb)"></a-mixin>
        <a-mixin id="loud-bicycle-mini" gltf-model="url(${assetUrl}sets/cycle-horn/gltf-exports/draco/loud-bicycle-mini-horn.glb)"></a-mixin>
        <a-mixin id="loud-bicycle-classic" gltf-model="url(${assetUrl}sets/cycle-horn/gltf-exports/draco/loud-bicycle-classic-horn.glb)"></a-mixin>
        <a-mixin id="building-school" gltf-model="url(${assetUrl}sets/school-building/gltf-exports/draco/school-building.glb)"></a-mixin>
        <a-mixin id="building-bar" gltf-model="url(${assetUrl}sets/irish-bar-building/gltf-exports/draco/irish-bar-building.glb)"></a-mixin>
        <a-mixin id="vehicle-bmw-m2" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/BWM_m2-rig.glb)"></a-mixin>
        <a-mixin id="prop-suburban-houses" gltf-model="url(${assetUrl}sets/suburban-houses/gltf-exports/draco/suburban-houses.glb)"></a-mixin>
        <a-mixin id="prop-banner-wfh" gltf-model="url(${assetUrl}sets/wfh-banner/gltf-exports/draco/wfh-banner.glb)"></a-mixin>
        <a-mixin id="prop-raygun" gltf-model="url(${assetUrl}sets/ray-gun/gltf-exports/draco/rayGun.glb)"></a-mixin>
        <a-mixin id="prop-co2-scrubber" gltf-model="url(${assetUrl}sets/c02-scrubber/gltf-exports/draco/co2-scrubber.glb)"></a-mixin>
    ` };

  if (categories) {
    const categoryAttrArray = categories.split(' ');
    const categoryExistsArray = Object.keys(assetsObj)
      .filter(key => categoryAttrArray.includes(key));
    let assetsHTML = '';
    for (const assetName in assetsObj) {
      if (categoryExistsArray.includes(assetName)) {
        assetsHTML += assetsObj[assetName];
      }
    }
    return assetsHTML;
  } else {
    const allHTMLAssets = Object.values(assetsObj).join('');
    return allHTMLAssets;
  }
}

class StreetAssets extends AFRAME.ANode {
  constructor () {
    super();
    this.isAssetItem = true;
  }

  connectedCallback () {
    const self = this;
    var categories = this.getAttribute('categories');
    var assetUrl = this.getAttribute('url');
    this.insertAdjacentHTML('afterend', buildAssetHTML(assetUrl, categories));
    AFRAME.ANode.prototype.load.call(self);
  }
}
customElements.define('street-assets', StreetAssets);

// add street-assets to scene if it doesn't already exist
var domModifiedHandler = function (evt) {
  // Only care about events affecting an a-scene
  if (evt.target.nodeName !== 'A-SCENE') return;

  // Try to find the a-assets element in the a-scene
  let assets = evt.target.querySelector('a-assets');

  if (!assets) {
    // attempt to create and add the assets if they don't already exist
    // TODO: this doesn't work well with images, so scenes must include <a-assets></a-assets> to run correctly
    assets = document.createElement('a-assets');
    evt.target.append(assets);
  }

  // Already have the streetmix assets. No need to add them
  if (assets.querySelector('street-assets')) {
    document.removeEventListener('DOMSubtreeModified', domModifiedHandler);
    return;
  }

  // Create and add the custom street-assets element
  const streetAssets = document.createElement('street-assets');
  assets.append(streetAssets);

  // Clean up by removing the event listener
  document.removeEventListener('DOMSubtreeModified', domModifiedHandler);
};

document.addEventListener('DOMSubtreeModified', domModifiedHandler, false);

/*
Unused assets kept commented here for future reference
        <!-- audio -->
        <audio id="ambientmp3" src="${assetUrl}audio/SSL_16_11_AMB_EXT_SF_ALAMO_SQ.mp3" preload="none" crossorigin="anonymous"></audio>
        <audio id="tram-pass-mp3" src="${assetUrl}audio/Tram-Pass-By-Fast-shortened.mp3" preload="auto" crossorigin="anonymous"></audio>
        <audio id="trolley-pass-mp3" src="${assetUrl}audio/Streetcar-passing.mp3" preload="auto" crossorigin="anonymous"></audio>
        <audio id="suburbs-mp3" src="${assetUrl}audio/AMB_Suburbs_Afternoon_Woods_Spring_Small_ST_MKH8050-30shortened_amplified.mp3" preload="none" crossorigin="anonymous"></audio>
        <audio id="parking-lot-mp3" src="${assetUrl}audio/Parking_lot_ambience_looping.mp3" preload="none" crossorigin="anonymous"></audio>
        <audio id="waterfront-mp3" src="${assetUrl}audio/combined_UKdock4_and_water_pier_underneath_ambience.mp3" preload="none" crossorigin="anonymous"></audio>
        <audio id="suburbs2-mp3" src="${assetUrl}audio/AMB_Suburbs_Spring_Day_Lawnmowers_Birds_MS_ST_MKH8050-30shortened.mp3" preload="none" crossorigin="anonymous"></audio>
        <!-- vehicle mixins with audio included -->
        <a-mixin id="tram" anisotropy gltf-model="#trammodel" sound="src: #tram-pass-mp3;positional:false;volume: 0.4"></a-mixin>
        <a-mixin id="trolley" gltf-model="#trolleymodel" sound="src: #trolley-pass-mp3;positional:false;volume: 0.4"scale="1 1 1"></a-mixin>

        <!-- ui / future use -->
        <img id="subtitle" src="${assetUrl}materials/subtitle.png" crossorigin="anonymous" />

        <!-- old vehicles -->
        <a-mixin id="old-sedan" gltf-part-plus="src: #vehicles; part: sedan"></a-mixin>
        <a-asset-item id="old-sedan-rigged" src="${assetUrl}sets/vehicles-rig/gltf-exports/draco/sedan-rig.glb"></a-asset-item>
        <a-mixin id="old-sedan-rig" gltf-model="#sedan-rigged" ></a-mixin>

*/
