/* global AFRAME, customElements */

function buildAssetHTML(assetUrl, categories) {
  // if (!assetUrl) assetUrl = 'https://assets.3dstreet.app/';
  console.log('[street]', 'Using street assets from', assetUrl);
  const surfacesRoughness = 0.8;
  var assetsObj = {
    'sidewalk-props': `
        <!-- sidewalk props -->
        <img id="wayfinding-map" src="${assetUrl}objects/wayfinding.jpg" crossorigin="anonymous" />
        <a-asset-item id="streetProps" src="${assetUrl}sets/street-props/gltf-exports/draco/street-props.glb"></a-asset-item>
        <a-asset-item id="brt-station-model" src="${assetUrl}sets/brt-station/gltf-exports/draco/brt-station.glb"></a-asset-item>
        <a-mixin shadow id="brt-station" gltf-model="#brt-station-model" ></a-mixin>
        <a-mixin shadow id="outdoor_dining" gltf-part="src: #streetProps; part: outdoor_dining"></a-mixin>
        <a-mixin shadow id="bench_orientation_center" gltf-part="src: #streetProps; part: bench_orientation_center"></a-mixin>
        <a-mixin shadow id="parklet" gltf-part="src: #streetProps; part: parklet"></a-mixin>
        <a-mixin shadow id="utility_pole" gltf-part="src: #streetProps; part: utility_pole"></a-mixin>
        <a-mixin shadow id="lamp-modern" gltf-part="src: #streetProps; part: street-light"></a-mixin>
        <a-mixin shadow id="lamp-modern-double" gltf-part="src: #streetProps; part: street-light-double"></a-mixin>
        <a-mixin shadow id="bikerack" gltf-part="src: #streetProps; part: bike_rack"></a-mixin>
        <a-mixin shadow id="bikeshare" gltf-part="src: #streetProps; part: bike_share"></a-mixin>
        <a-mixin shadow id="lamp-traditional" gltf-part="src: #streetProps; part: lamp_post_traditional" scale="2 2 2"></a-mixin>
        <a-mixin shadow id="palm-tree" gltf-part="src: #streetProps; part: palmtree" scale="1 1.5 1"></a-mixin>
        <a-mixin shadow id="bench" gltf-part="src: #streetProps; part: park_bench"></a-mixin>
        <a-mixin shadow id="seawall" gltf-part="src: #streetProps; part: sea_wall"></a-mixin>
        <a-mixin shadow id="track" gltf-part="src: #streetProps; part: track"></a-mixin>
        <a-mixin shadow id="tree3" gltf-part="src: #streetProps; part: tree-01" scale="1.25 1.25 1.25"></a-mixin>
        <a-mixin shadow id="bus-stop" gltf-part="src: #streetProps; part: transit-shelter-1"></a-mixin>
        <a-mixin shadow id="pride-flag" position="0.409 3.345 0" rotation="0 0 0" scale="0.5 0.75 0" geometry="width:2;height:2;primitive:plane" material="side:double; src:${assetUrl}materials/rainbow-flag-poles_512.png;transparent: true;"></a-mixin>
        <a-mixin shadow id="wayfinding-box" geometry="primitive: box; height: 2; width: 0.84; depth: 0.1" material="color: gray"></a-mixin>
      `,
    people: `
        <!-- human characters -->
        <a-asset-item id="humans" src="${assetUrl}sets/human-characters-poses-1/gltf-exports/draco/human-characters-poses-1.glb"></a-asset-item>
        <a-mixin shadow id="char1" gltf-part="src: #humans; part: Character_1"></a-mixin>
        <a-mixin shadow id="char2" gltf-part="src: #humans; part: Character_2"></a-mixin>
        <a-mixin shadow id="char3" gltf-part="src: #humans; part: Character_3"></a-mixin>
        <a-mixin shadow id="char4" gltf-part="src: #humans; part: Character_4"></a-mixin>
        <a-mixin shadow id="char5" gltf-part="src: #humans; part: Character_5"></a-mixin>
        <a-mixin shadow id="char6" gltf-part="src: #humans; part: Character_6"></a-mixin>
        <a-mixin shadow id="char7" gltf-part="src: #humans; part: Character_7"></a-mixin>
        <a-mixin shadow id="char8" gltf-part="src: #humans; part: Character_8"></a-mixin>
        <a-asset-item id="humans2" src="${assetUrl}sets/human-characters-poses-2/gltf-exports/draco/human-characters-poses-2.glb"></a-asset-item>
        <a-mixin shadow id="char9" gltf-part="src: #humans2; part: Character_9"></a-mixin>
        <a-mixin shadow id="char10" gltf-part="src: #humans2; part: Character_10"></a-mixin>
        <a-mixin shadow id="char11" gltf-part="src: #humans2; part: Character_11"></a-mixin>
        <a-mixin shadow id="char12" gltf-part="src: #humans2; part: Character_12"></a-mixin>
        <a-mixin shadow id="char13" gltf-part="src: #humans2; part: Character_13"></a-mixin>
        <a-mixin shadow id="char14" gltf-part="src: #humans2; part: Character_14"></a-mixin>
        <a-mixin shadow id="char15" gltf-part="src: #humans2; part: Character_15"></a-mixin>
        <a-mixin shadow id="char16" gltf-part="src: #humans2; part: Character_16"></a-mixin>
      `,
    'people-rigged': `          
        <a-asset-item id="character1walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-1-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char1" gltf-model="#character1walk" animation-mixer></a-mixin>
        
        <a-asset-item id="character2walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-2-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char2" gltf-model="#character2walk" animation-mixer></a-mixin>
        <a-asset-item id="character3walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-3-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char3" gltf-model="#character3walk" animation-mixer></a-mixin>
        <a-asset-item id="character4walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-4-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char4" gltf-model="#character4walk" animation-mixer></a-mixin>
        <a-asset-item id="character5walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-5-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char5" gltf-model="#character5walk" animation-mixer></a-mixin>
        <a-asset-item id="character6walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-6-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char6" gltf-model="#character6walk" animation-mixer></a-mixin>
        <a-asset-item id="character7walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-7-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char7" gltf-model="#character7walk" animation-mixer></a-mixin>
        <a-asset-item id="character8walk" src="${assetUrl}sets/human-characters-animation-seperated/gltf-exports/draco/character-8-walk.glb"></a-asset-item>
        <a-mixin shadow id="a_char8" gltf-model="#character8walk" animation-mixer></a-mixin>
      `,
    vehicles: `
        <!-- vehicles -->
        <a-asset-item id="magic-carpet-glb" src="${assetUrl}sets/magic-carpet/gltf-exports/draco/magic-carpet.glb"></a-asset-item>
        <a-mixin shadow id="Character_1_M" gltf-part="src: #magic-carpet-glb; part: Character_1_M"></a-mixin>
        <a-mixin shadow id="magic-carpet" gltf-part="src: #magic-carpet-glb; part: magic-carpet"></a-mixin>
        <!-- micro mobility vehicles -->
        <a-asset-item id="microMobilityDevices" src="${assetUrl}sets/micro-mobility-devices/gltf-exports/draco/micro-mobility-devices_v01.glb"></a-asset-item>
        <a-mixin shadow id="Bicycle_1" gltf-part="src: #microMobilityDevices; part: Bicycle_1"></a-mixin>
        <a-mixin shadow id="ElectricScooter_1" gltf-part="src: #microMobilityDevices; part: ElectricScooter_1"></a-mixin>
      `,
    'vehicles-rigged': `
        <!-- vehicles rigged -->
        <a-mixin shadow id="sedan-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/toyota-prius-rig.glb)" ></a-mixin>
        <a-mixin shadow id="sedan-taxi-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/sedan-taxi-rig.glb)"></a-mixin>
        <a-mixin shadow id="suv-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/suv-rig.glb)"></a-mixin>
        <a-mixin shadow id="box-truck-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/isuzu-truck-rig.glb)"></a-mixin>
        <a-mixin shadow id="food-trailer-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/food-trailer-rig.glb)"></a-mixin>
        <a-mixin shadow id="fire-truck-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/fire-truck-pumper-rig.glb)"></a-mixin>
        <a-mixin shadow id="fire-ladder-rig" gltf-model="url(${assetUrl}sets/vehicles/gltf-exports/draco/fire_truck_ladder.glb)"></a-mixin>
        <a-mixin shadow id="trash-truck-side-loading" gltf-model="url(${assetUrl}sets/vehicles/gltf-exports/draco/trash-truck-side-loading.glb)"></a-mixin>
        <a-mixin shadow id="self-driving-cruise-car-rig" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/self-driving-cruise-car-rig.glb)"></a-mixin>
        <a-mixin shadow id="self-driving-waymo-car" gltf-model="url(${assetUrl}sets/vehicles/gltf-exports/draco/waymo-self-driving-car.glb)"></a-mixin>
      `,
    buildings: `
        <!-- blocks -->
        <a-asset-item id="blockmodel" src="${assetUrl}sets/buildings/gltf-exports/draco/buildings.glb"></a-asset-item>
        <a-asset-item id="archedmodel" src="${assetUrl}sets/arcade-style-buildings/gltf-exports/draco/arched-buildings.glb"></a-asset-item>
        <a-asset-item id="suburbiamodel" src="${assetUrl}sets/suburban-houses/gltf-exports/draco/suburban-houses.glb"></a-asset-item>

        <!-- buildings and blocks -->
        <a-mixin shadow id="SM3D_Bld_Mixed_Corner_4fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_Corner_4fl"></a-mixin>
        <a-mixin shadow id="SM3D_Bld_Mixed_Double_5fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_Double_5fl"></a-mixin>
        <a-mixin shadow id="SM3D_Bld_Mixed_4fl_2" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_4fl_2"></a-mixin>
        <a-mixin shadow id="SM3D_Bld_Mixed_5fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_5fl"></a-mixin>
        <a-mixin shadow id="SM3D_Bld_Mixed_4fl" scale="1 1 1" rotation="0 0 0" gltf-part="src: #blockmodel; part: SM3D_Bld_Mixed_4fl"></a-mixin>

        <!-- suburban buildings -->
        <a-mixin shadow id="SM_Bld_House_Preset_03_1800" scale="1 1 1" rotation="0 0 0" gltf-part="src: #suburbiamodel; part: suburban-house_1"></a-mixin>
        <a-mixin shadow id="SM_Bld_House_Preset_08_1809" scale="1 1 1" rotation="0 0 0" gltf-part="src: #suburbiamodel; part: suburban-house_3"></a-mixin>
        <a-mixin shadow id="SM_Bld_House_Preset_09_1845" scale="1 1 1" rotation="0 0 0" gltf-part="src: #suburbiamodel; part: suburban-house_2"></a-mixin>

        <!-- arched style buildings -->
        <a-mixin shadow id="arched-building-01" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-01"></a-mixin>
        <a-mixin shadow id="arched-building-02" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-02"></a-mixin>
        <a-mixin shadow id="arched-building-03" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-03"></a-mixin>
        <a-mixin shadow id="arched-building-04" scale="1 1 1" rotation="0 0 0" gltf-part="src: #archedmodel; part: arched-building-04"></a-mixin>
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
        <img id="seamless-sidewalk" src="${assetUrl}materials/TexturesCom_FloorsRegular0301_1_seamless_S.jpg" crossorigin="anonymous">
        <img id="hatched-base" src="${assetUrl}materials/seamless-lane-with-hatch-half.jpg" crossorigin="anonymous">
        <img id="hatched-normal" src="${assetUrl}materials/seamless-lane-with-hatch-half.jpg" crossorigin="anonymous">
        <a-mixin shadow="cast: false" id="drive-lane" geometry="width:3;height:150;primitive:plane" material="roughness:${surfacesRoughness};repeat:0.3 25;offset:0.55 0;src:#seamless-road;"></a-mixin>
        <a-mixin shadow="cast: false" id="bright-lane" geometry="width:3;height:150;primitive:plane" material="roughness:${surfacesRoughness};repeat:0.6 50;offset:0.55 0;src:#seamless-bright-road;color:#dddddd"></a-mixin>
        <a-mixin shadow="cast: false" id="bike-lane" geometry="width:1.8;height:150;primitive:plane" material="roughness:${surfacesRoughness};repeat:0.3 25;offset:0.55 0;metalness:0;src:#seamless-road;"></a-mixin>
        <a-mixin shadow id="sidewalk" anisotropy geometry="width:3;height:150;primitive:plane" material="roughness:${surfacesRoughness};repeat:1.5 75;src:#seamless-sidewalk;"></a-mixin>
        <a-mixin shadow="cast: false" id="bus-lane" geometry="width:3;height:150;primitive:plane" material="roughness:${surfacesRoughness};repeat:0.3 25;offset:0.55 0;src:#seamless-road;"></a-mixin>
        <a-mixin shadow="cast: false" id="divider" geometry="width:0.3;height:150;primitive:plane" material="roughness:${surfacesRoughness};src:#hatched-base;"></a-mixin>
        <a-mixin shadow="cast: false" id="grass" geometry="width:0.3;height:150;primitive:plane" material="roughness:${surfacesRoughness};repeat:1 150;offset:0.415 0;src:#grass-texture;"></a-mixin>
      `,
    'segment-colors': `  
        <!-- segment color modifier mixins -->
        <a-mixin id="yellow" material="color:#f7d117"></a-mixin>
        <a-mixin id="surface-green" material="color:#adff83"></a-mixin>
        <a-mixin id="surface-red" material="color:#ff9393"></a-mixin>
        <a-mixin id="surface-blue" material="color:#00b6b6"></a-mixin>
      `,
    'lane-separator': `
        <!-- lane separator markings -->
        <img id="markings-atlas" src="${assetUrl}materials/lane-markings-atlas_1024.png" crossorigin="anonymous" /> 
        <a-mixin shadow="cast: false" id="markings" anisotropy atlas-uvs="totalRows: 1; totalColumns: 8; row: 1" scale="1 1 1" material="src: #markings-atlas;alphaTest: 0;transparent:true;repeat:1 25;" geometry="primitive: plane; buffer: false; skipCache: true; width:0.2; height:150;"></a-mixin>
        <a-mixin shadow="cast: false" id="solid-stripe" atlas-uvs="column: 3; row: 1" material="repeat:1 5;"></a-mixin>
        <a-mixin shadow="cast: false" id="dashed-stripe" atlas-uvs="column: 4; row: 1"></a-mixin>
        <a-mixin shadow="cast: false" id="short-dashed-stripe" atlas-uvs="column: 4" material="repeat:1 50;"></a-mixin>
        <a-mixin shadow="cast: false" id="solid-doubleyellow" atlas-uvs="totalColumns: 4; column: 3" geometry="width: 0.5"></a-mixin>
        <a-mixin shadow="cast: false" id="solid-dashed" atlas-uvs="totalColumns: 4; column: 2" geometry="width: 0.4"></a-mixin>
        <a-mixin shadow="cast: false" id="crosswalk-zebra" atlas-uvs="totalColumns: 4; column: 4" geometry="width: 2; height: 12"  material="repeat: 1 2"></a-mixin>
      `,
    stencils: `  
        <!-- stencil markings -->
        <img id="stencils-atlas" src="${assetUrl}materials/stencils-atlas_2048.png" crossorigin="anonymous" />
        <a-mixin shadow="cast: false" id="stencils" anisotropy atlas-uvs="totalRows: 4; totalColumns: 4" scale="2 2 2" material="src: #stencils-atlas;alphaTest: 0;transparent:true;" geometry="primitive: plane; buffer: false; skipCache: true;"></a-mixin>
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
        <a-mixin id="hash-left" atlas-uvs="totalRows: 4; totalColumns: 8; column: 7; row: 2" scale="3 6 3"></a-mixin>
        <a-mixin id="hash-right" atlas-uvs="totalRows: 4; totalColumns: 8; column: 8; row: 2" scale="3 6 3"></a-mixin>
        <a-mixin id="hash-chevron" atlas-uvs="totalRows: 4; totalColumns: 4; column: 4; row: 2" scale="3 3 3"></a-mixin>
      `,
    'vehicles-transit': `
        <!-- vehicles-transit -->
        <a-mixin shadow id="bus" anisotropy gltf-model="url(${assetUrl}sets/flyer-bus/gltf-exports/draco/new-flyer-bus.glb)"></a-mixin>
        <a-mixin shadow id="tram" anisotropy gltf-model="url(${assetUrl}sets/light-rail-vehicle/gltf-exports/draco/light_rail_vehicle.glb)"></a-mixin>
        <a-mixin shadow id="trolley" gltf-model="url(${assetUrl}sets/sanfrancisco-cablecar/gltf-exports/draco/sanfrancisco-cablecar_v01.glb)"></a-mixin>
        `,
    dividers: `
        <!-- dividers - aka street design elements -->
        <a-asset-item id="dividers" src="${assetUrl}sets/dividers/gltf-exports/draco/dividers.glb"></a-asset-item>        
        <a-mixin shadow id="dividers-flowers" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: flowers"></a-mixin>
        <a-mixin shadow id="dividers-planting-strip" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: planting-strip"></a-mixin>
        <a-mixin shadow id="dividers-planter-box" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: planter-box"></a-mixin>
        <a-mixin shadow id="dividers-bush" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: bush"></a-mixin>
        <a-mixin shadow id="dividers-dome" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: dome"></a-mixin>
        <a-mixin shadow id="safehit" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: bollard"></a-mixin>
        <a-mixin shadow id="temporary-barricade" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: barricade"></a-mixin>
        <a-mixin shadow id="temporary-traffic-cone" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: traffic-cone"></a-mixin>
        <a-mixin shadow id="temporary-jersey-barrier-plastic" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: jersey-barrier-plastic"></a-mixin>
        <a-mixin shadow id="temporary-jersey-barrier-concrete" scale="1 1 1" rotation="0 0 0" gltf-part="src: #dividers; part: jersey-barrier-concrete"></a-mixin>
        <a-mixin shadow id="street-element-crosswalk-raised" scale="1 1 1" rotation="0 0 0" gltf-model="url(${assetUrl}sets/uoregon/gltf-exports/draco/crosswalk-raised.glb)"></a-mixin>
        <a-mixin shadow id="street-element-traffic-island-end-rounded" scale="1.5 1.5 1.5" rotation="0 0 0" gltf-model="url(${assetUrl}sets/uoregon/gltf-exports/draco/curb-island-end-rounded.glb)"></a-mixin>
        <a-mixin shadow id="street-element-sign-warning-ped-rrfb" scale="1.5 1.5 1.5" rotation="0 0 0" gltf-model="url(${assetUrl}sets/uoregon/gltf-exports/draco/sign-warning-ped-rrfb.glb)"></a-mixin>
        <a-mixin shadow id="street-element-traffic-post-k71" scale="1 1 1" rotation="0 0 0" gltf-model="url(${assetUrl}sets/uoregon/gltf-exports/draco/traffic-post-k71.glb)"></a-mixin>
        <a-mixin shadow id="street-element-traffic-island" scale="1.5 1.5 1.5" rotation="0 0 0" gltf-model="url(${assetUrl}sets/uoregon/gltf-exports/draco/curb-traffic-island.glb)"></a-mixin>
        <a-mixin shadow id="street-element-speed-hump" scale="1.5 1.5 1.5" rotation="0 0 0" gltf-model="url(${assetUrl}sets/uoregon/gltf-exports/draco/speed-hump.glb)"></a-mixin>
        <a-mixin shadow id="crosswalk-zebra-box" geometry="primitive: box; height: 0.1; width: 2; depth: 10" material="src: url(${assetUrl}materials/markings-crosswalk.png)"></a-mixin>
        `,
    sky: `
        <!-- sky -->
        <img id="sky" src="${assetUrl}images/skies/2048-polyhaven-wasteland_clouds_puresky.jpeg" crossorigin="anonymous" />
        <img id="sky-night" src="${assetUrl}images/AdobeStock_286725174-min.jpeg" crossorigin="anonymous" />
      `,
    grounds: `
        <!-- grounds -->
        <img id="grass-texture" src="${assetUrl}materials/TexturesCom_Grass0052_1_seamless_S.jpg" crossorigin="anonymous">
        <img id="parking-lot-texture" src="${assetUrl}materials/TexturesCom_Roads0111_1_seamless_S.jpg" crossorigin="anonymous">
        <img id="asphalt-texture" src="${assetUrl}materials/TexturesCom_AsphaltDamaged0057_1_seamless_S.jpg" crossorigin="anonymous">

        <!-- legacy plane-based grounds for compatibility with 0.4.2 and earlier scenes, not used for new streets -->
        <a-mixin shadow id="ground-grass" rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#grass-texture;repeat:5 5;roughness:1"></a-mixin>
        <a-mixin shadow id="ground-parking-lot" rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#parking-lot-texture;repeat:2 4;roughness:1"></a-mixin>
        <a-mixin shadow id="ground-asphalt" rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#asphalt-texture;repeat:5 5;roughness:1"></a-mixin>
        <a-mixin shadow id="ground-tiled-concrete" anisotropy rotation="-90 0 0" geometry="primitive:plane;height:150;width:40" material="src:#seamless-sidewalk;repeat:5 5;roughness:1"></a-mixin>

        <!-- new grounds for 0.4.4 and later --> 
        <a-mixin shadow id="ground-grass-material" material="src:#grass-texture;repeat:2.5 5;roughness:${surfacesRoughness}"></a-mixin>
        <a-mixin shadow id="ground-parking-lot-material" material="src:#parking-lot-texture;repeat:.5 2;roughness:${surfacesRoughness}"></a-mixin>
        <a-mixin shadow id="ground-asphalt-material" material="src:#asphalt-texture;repeat:5 5;roughness:${surfacesRoughness}"></a-mixin>
        <a-mixin shadow id="ground-tiled-concrete-material" material="src:#seamless-sidewalk;repeat:10 20;roughness:${surfacesRoughness}"></a-mixin>

        <a-asset-item id="fence-model" src="${assetUrl}sets/fences/gltf-exports/draco/fence4.glb"></a-asset-item>
        <a-mixin shadow id="fence" gltf-model="#fence-model" scale="0.1 0.1 0.1"></a-mixin>
      `,
    cyclists: `
        <a-mixin shadow id="cyclist-cargo" gltf-model="url(${assetUrl}sets/cargo-bike-animation/gltf-exports/draco/cargo_bike_animation_v1.glb)"></a-mixin>
        <a-mixin shadow id="cyclist1" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/cyclist-1-animation-v1.glb)"></a-mixin>
        <a-mixin shadow id="cyclist2" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/cyclist-2-animation-v1.glb)"></a-mixin>
        <a-mixin shadow id="cyclist3" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/cyclist-3-animation-v1.glb)"></a-mixin>
        <a-mixin shadow id="cyclist-kid" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/Kid_cyclist_animation_v01.glb)"></a-mixin>
        <a-mixin shadow id="cyclist-dutch" gltf-model="url(${assetUrl}sets/cyclist-animation/gltf-exports/draco/Dutch_cyclist_animation_v01.glb)"></a-mixin>
      `,
    'loud-bicycle': `
        <!-- loud-bicycle-game -->
        <a-mixin shadow id="loud-bicycle-mini" gltf-model="url(${assetUrl}sets/cycle-horn/gltf-exports/draco/loud-bicycle-mini-horn.glb)"></a-mixin>
        <a-mixin shadow id="loud-bicycle-classic" gltf-model="url(${assetUrl}sets/cycle-horn/gltf-exports/draco/loud-bicycle-classic-horn.glb)"></a-mixin>
        <a-mixin shadow id="building-school" gltf-model="url(${assetUrl}sets/school-building/gltf-exports/draco/school-building.glb)"></a-mixin>
        <a-mixin shadow id="building-bar" gltf-model="url(${assetUrl}sets/irish-bar-building/gltf-exports/draco/irish-bar-building.glb)"></a-mixin>
        <a-mixin shadow id="vehicle-bmw-m2" gltf-model="url(${assetUrl}sets/vehicles-rig/gltf-exports/draco/BWM_m2-rig.glb)"></a-mixin>
        <a-mixin shadow id="prop-suburban-houses" gltf-model="url(${assetUrl}sets/suburban-houses/gltf-exports/draco/suburban-houses.glb)"></a-mixin>
        <a-mixin shadow id="prop-banner-wfh" gltf-model="url(${assetUrl}sets/wfh-banner/gltf-exports/draco/wfh-banner.glb)"></a-mixin>
        <a-mixin shadow id="prop-raygun" gltf-model="url(${assetUrl}sets/ray-gun/gltf-exports/draco/rayGun.glb)"></a-mixin>
        <a-mixin shadow id="prop-co2-scrubber" gltf-model="url(${assetUrl}sets/c02-scrubber/gltf-exports/draco/co2-scrubber.glb)"></a-mixin>
    `
  };

  function addCategoryNamesToMixins(html, categoryName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const mixinNodes = doc.querySelectorAll('a-mixin');
    mixinNodes.forEach((mixinNode) => {
      mixinNode.setAttribute('category', categoryName);
    });
    return doc.documentElement.innerHTML;
  }

  // JSON with grouped mixin id's. Used to create grouped mixins in Editor right panel
  let existsCategoryArray = Object.keys(assetsObj);

  if (categories) {
    // if there is a categories attribute, then use the categories from it
    const categoryAttrArray = categories.split(' ');
    existsCategoryArray = existsCategoryArray.filter((key) =>
      categoryAttrArray.includes(key)
    );
  }

  let assetsHTML = '';
  for (const categoryName in assetsObj) {
    if (existsCategoryArray.includes(categoryName)) {
      const assetsCategoryHTML = assetsObj[categoryName];
      assetsHTML += addCategoryNamesToMixins(assetsCategoryHTML, categoryName);
    }
  }
  return assetsHTML;
}

class StreetAssets extends AFRAME.ANode {
  constructor() {
    super();
    this.isAssetItem = true;
  }

  connectedCallback() {
    const self = this;
    var categories = this.getAttribute('categories');
    var assetUrl = this.getAttribute('url');
    if (!assetUrl) {
      assetUrl = 'https://assets.3dstreet.app/';
      this.setAttribute('url', assetUrl);
    }
    const assetsHTML = buildAssetHTML(assetUrl, categories);

    this.insertAdjacentHTML('afterend', assetsHTML);

    AFRAME.ANode.prototype.load.call(self);
  }
}
customElements.define('street-assets', StreetAssets);
// Function to add street-assets if it doesn't already exist
function addStreetAssets(scene) {
  let assets = scene.querySelector('a-assets');

  if (!assets) {
    assets = document.createElement('a-assets');
    scene.appendChild(assets);
  }

  if (!assets.querySelector('street-assets')) {
    const streetAssets = document.createElement('street-assets');
    assets.appendChild(streetAssets);
  }
}

// Set up the MutationObserver
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      const addedNodes = mutation.addedNodes;
      for (const node of addedNodes) {
        if (node.nodeName === 'A-SCENE') {
          addStreetAssets(node);
          // We've found and processed an a-scene, so we can disconnect the observer
          observer.disconnect();
          return;
        }
      }
    }
  }
});

// Function to start observing
function startObserving() {
  // Immediate check in case the a-scene is already in the DOM
  const existingScene = document.querySelector('a-scene');
  if (existingScene) {
    addStreetAssets(existingScene);
  } else {
    // Start observing the document with the configured parameters
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// Wait for the DOM to be fully loaded before starting the observer
if (document.readyState !== 'complete') {
  document.addEventListener('DOMContentLoaded', startObserving);
} else {
  // DOMContentLoaded has already fired
  startObserving();
}
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
