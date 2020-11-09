/* global AFRAME */

// doc assets
document.addEventListener('DOMContentLoaded', function (event) {
  let assets = document.querySelector('a-assets');
//   console.log('assets', assets);

  // IF NO A-ASSETS, then create one
  if (!assets) {
//     console.log('no assets exist');

    assets = document.createElement('a-assets');
    document.querySelector('a-scene').append(assets);
  }

  var assetUrl = ''; // default is use current directory as root

  // if asset component attribute value assetUrl   
  // <a-asset-item streetmixAssets="assetUrl: https://unpkg.com/streetmix3d@0.0.1/"></a-asset>
  var streetmixAssetsEl = assets.querySelector('[streetmix-assets-url]');
//   console.log('streetmixAssetsEl', streetmixAssetsEl);
//   console.log('streetmixAssetsEl', streetmixAssetsEl.assetUrl);

  if (streetmixAssetsEl) {
    assetUrl = streetmixAssetsEl.getAttribute('streetmix-assets-url');
//     console.log('New assetUrl=', assetUrl);
  } else {
//     console.log('NO streetmixAssetsEl found');
  }

  // if (document.currentScript) {
  //   assetUrl = document.currentScript.src.split('/').slice(0, 3).join('/');
  // }

  console.log('Using assetUrl value: ', assetUrl);

  const assetsInnerHTML = `
          <!-- audio -->
          <audio id="ambientmp3" src="${assetUrl}assets/audio/SSL_16_11_AMB_EXT_SF_ALAMO_SQ.mp3" preload="none" crossorigin="anonymous"></audio>
          <audio id="tram-pass-mp3" src="${assetUrl}assets/audio/Tram-Pass-By-Fast-shortened.mp3" preload="auto" crossorigin="anonymous"></audio>
          <audio id="trolley-pass-mp3" src="${assetUrl}assets/audio/Streetcar-passing.mp3" preload="auto" crossorigin="anonymous"></audio>
          <audio id="suburbs-mp3" src="${assetUrl}assets/audio/AMB_Suburbs_Afternoon_Woods_Spring_Small_ST_MKH8050-30shortened_amplified.mp3" preload="auto" crossorigin="anonymous"></audio>
          <audio id="parking-lot-mp3" src="${assetUrl}assets/audio/Parking_lot_ambience_looping.mp3" preload="auto" crossorigin="anonymous"></audio>
          <audio id="waterfront-mp3" src="${assetUrl}assets/audio/combined_UKdock4_and_water_pier_underneath_ambience.mp3" preload="auto" crossorigin="anonymous"></audio>
          <audio id="suburbs2-mp3" src="${assetUrl}assets/audio/AMB_Suburbs_Spring_Day_Lawnmowers_Birds_MS_ST_MKH8050-30shortened.mp3" preload="auto" crossorigin="anonymous"></audio>
  
          <!-- sidewalk props -->
          <a-asset-item id="treemodel3" src="${assetUrl}assets/objects/SM_Env_Tree_03.gltf"></a-asset-item>
          <a-asset-item id="palmtreemodel" src="${assetUrl}assets/objects/PalmTree.gltf"></a-asset-item>
          <a-asset-item id="benchmodel" src="${assetUrl}assets/objects/SM_Prop_ParkBench_02.gltf"></a-asset-item>
          <a-asset-item id="bikerackmodel" src="${assetUrl}assets/objects/bikerack.glb"></a-asset-item>
          <a-asset-item id="bikesharemodel" src="${assetUrl}assets/objects/bikeshare.glb"></a-asset-item>
          <a-asset-item id="lamp-modern-glb" src="${assetUrl}assets/objects/lamp-post-modern-centered.glb"></a-asset-item>
          <a-asset-item id="lamp-traditional-glb" src="${assetUrl}assets/objects/lamp-post-traditional.glb"></a-asset-item>
          <a-asset-item id="bus-stop-glb" src="${assetUrl}assets/objects/ccFO2EGGIq9-bus-stop.glb"></a-asset-item>
          <img id="wayfinding-map" src="${assetUrl}assets/objects/wayfinding.jpg" crossorigin="anonymous" />
  
          <!-- vehicles -->
          <a-asset-item id="trammodel" src="${assetUrl}assets/objects/tram_siemens_avenio.gltf"></a-asset-item>
          <a-asset-item id="trolleymodel" src="${assetUrl}assets/objects/godarvilletram.gltf"></a-asset-item>
          <a-asset-item id="xd40" src="${assetUrl}assets/objects/bus/xd40-draco.glb"></a-asset-item>
          <a-asset-item id="carmodel" src="${assetUrl}assets/objects/SM_Veh_Car_Sedan_01.gltf"></a-asset-item>
  
          <!-- blocks -->
          <a-asset-item id="blockmodel" src="${assetUrl}assets/objects/buildings.glb"></a-asset-item>
          <a-asset-item id="suburbiamodel" src="${assetUrl}assets/objects/suburbia/suburbia-fixwindowuvs-only3-draco.glb"></a-asset-item>
  
          <a-asset-item id="fence-model" src="${assetUrl}assets/objects/fence4/fence4.gltf"></a-asset-item>
          <a-asset-item id="seawall-model" src="${assetUrl}assets/objects/seawall.gltf"></a-asset-item>
  
          <!-- lane objects -->
          <a-asset-item id="trackmodel" src="${assetUrl}assets/objects/track.gltf"></a-asset-item>
          <a-asset-item id="flexiguide-glb" src="${assetUrl}assets/objects/flexiguide300.glb"></a-asset-item>
          <img id="stencils-atlas" src="${assetUrl}assets/materials/stencils-atlas_2048.png" crossorigin="anonymous" />
          <img id="markings-atlas" src="${assetUrl}assets/materials/lane-markings-atlas_1024.png" crossorigin="anonymous" />
  
          <!-- optimized textures - used by default -->
          <a-mixin id="drive-lane-t1" geometry="width:3;height:150;primitive:plane" material="repeat:0.3 25;offset:0.55 0;src:${assetUrl}assets/materials/TexturesCom_Roads0086_1_seamless_S_rotate.jpg;"></a-mixin>
          <a-mixin id="bike-lane-t1" geometry="width:1.8;height:150;primitive:plane" material="repeat:0.3 25;offset:0.55 0;roughness:1;metalness:0;src:${assetUrl}assets/materials/TexturesCom_Roads0086_1_seamless_S_rotate.jpg;"></a-mixin>
          <a-mixin id="sidewalk-t1" anisotropy geometry="width:3;height:150;primitive:plane" material="repeat:1.5 75;src:${assetUrl}assets/materials/TexturesCom_FloorsRegular0301_1_seamless_S.jpg;"></a-mixin>
          <a-mixin id="bus-lane-t1" geometry="width:3;height:150;primitive:plane" material="repeat:0.3 25;offset:0.55 0;src:${assetUrl}assets/materials/TexturesCom_Roads0086_1_seamless_S_rotate.jpg;"></a-mixin>
          <a-mixin id="divider-t1" geometry="width:0.3;height:150;primitive:plane" material="repeat:1 150;offset:0.415 0;normalTextureOffset:0.415 0;src:${assetUrl}assets/materials/hatched_Base_Color.jpg;normalTextureRepeat:0.21 150;normalMap:${assetUrl}assets/materials/hatched_Normal.jpg"></a-mixin>
          <a-mixin id="safehit" gltf-model="#flexiguide-glb" scale="1 1 1"></a-mixin>
  
          <!-- lane separator markings atlas -->
          <a-mixin id="markings" anisotropy atlas-uvs="totalRows: 1; totalColumns: 8; row: 1" scale="1 1 1" material="src: #markings-atlas;alphaTest: 0;transparent:true;repeat:1 25;" geometry="primitive: plane; buffer: false; skipCache: true; width:0.2; height:150;"></a-mixin>
          <a-mixin id="solid-stripe-t1" atlas-uvs="column: 3"></a-mixin>
          <a-mixin id="dashed-stripe-t1" atlas-uvs="column: 4"></a-mixin>
          <a-mixin id="short-dashed-stripe-t1" atlas-uvs="column: 4" material="repeat:1 50;"></a-mixin>
          <a-mixin id="solid-doubleyellow-t1" atlas-uvs="totalColumns: 4; column: 3" geometry="width: 0.5"></a-mixin>
          <a-mixin id="solid-dashed-t1" atlas-uvs="totalColumns: 4; column: 2" geometry="width: 0.4"></a-mixin>
  
          <!-- color modifier mixins -->
          <a-mixin id="yellow" material="color:#f7d117"></a-mixin>
          <a-mixin id="surface-green" material="color:#adff83"></a-mixin>
          <a-mixin id="surface-red" material="color:#ff9393"></a-mixin>
  
          <!-- stencils atlas -->
          <a-mixin id="stencils" anisotropy atlas-uvs="totalRows: 4; totalColumns: 4" scale="2 2 2" material="src: #stencils-atlas;alphaTest: 0;transparent:true;" geometry="primitive: plane; buffer: false; skipCache: true"></a-mixin>
          <a-mixin id="right" atlas-uvs="column: 3; row: 2"></a-mixin>
          <a-mixin id="left" atlas-uvs="column: 3; row: 3"></a-mixin>
          <a-mixin id="both" atlas-uvs="column: 2; row: 1"></a-mixin>
          <a-mixin id="all" atlas-uvs="column: 3; row: 1"></a-mixin>
          <a-mixin id="left-straight" atlas-uvs="column: 2; row: 3"></a-mixin>
          <a-mixin id="right-straight" atlas-uvs="column: 2; row: 2"></a-mixin>
          <a-mixin id="straight" atlas-uvs="column: 2; row: 4"></a-mixin>
          <a-mixin id="sharrow" atlas-uvs="totalRows: 4; totalColumns: 8; column: 2; row: 3" scale="1.5 3 1"></a-mixin>
          <a-mixin id="bike-lane" atlas-uvs="totalRows: 2; totalColumns: 8; column: 1; row: 2" scale="1 4 1"></a-mixin>
          <a-mixin id="word-bus" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 4" scale="3 3 3"></a-mixin>
          <a-mixin id="word-lane" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 4" scale="3 3 3"></a-mixin>
          <a-mixin id="word-taxi" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 3" scale="3 3 3"></a-mixin>
          <a-mixin id="word-only" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 3" scale="3 3 3"></a-mixin>
          <a-mixin id="word-yield" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 2" scale="3 3 3"></a-mixin>
          <a-mixin id="word-slow" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 2" scale="3 3 3"></a-mixin>
          <a-mixin id="word-xing" atlas-uvs="totalRows: 8; totalColumns: 8; column: 1; row: 1" scale="3 3 3"></a-mixin>
          <a-mixin id="word-stop" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 1" scale="3 3 3"></a-mixin>
          <a-mixin id="perpendicular-stalls" atlas-uvs="totalRows: 4; totalColumns: 8; column: 5; row: 4" scale="5 10 5"></a-mixin>
          <a-mixin id="parking-delimiter" atlas-uvs="totalRows: 8; totalColumns: 8; column: 2; row: 7" scale="1.8 1.8 1.8"></a-mixin>
  
          <!-- vehicles -->
          <a-mixin id="bus" anisotropy gltf-model="#xd40" scale="1.55 1.55 1.55"></a-mixin>
          <a-mixin id="car" gltf-model="#carmodel"></a-mixin>
          <a-mixin id="tram" anisotropy gltf-model="#trammodel" sound="src: #tram-pass-mp3;positional:false;volume: 0.4"></a-mixin>
          <a-mixin id="trolley" gltf-model="#trolleymodel" sound="src: #trolley-pass-mp3;positional:false;volume: 0.4"scale="1 1 1"></a-mixin>
          <a-mixin id="bus-shadow" geometry="width: 12; height: 3; primitive: plane"  material="src: url(${assetUrl}assets/materials/bus-shadow.png); alphaTest: 0;transparent:true; roughness: 1;" ></a-mixin>
          <a-mixin id="car-shadow" geometry="width: 4.7; height: 2.5; primitive: plane"  material="src: url(${assetUrl}assets/materials/bus-shadow.png); alphaTest: 0;transparent:true; roughness: 1;" ></a-mixin>
  
          <!-- street props -->
          <a-mixin id="tree3" gltf-model="#treemodel3" scale="1.25 1.25 1.25"></a-mixin>
          <a-mixin id="palm-tree" gltf-model="#palmtreemodel" scale="1 1.5 1"></a-mixin>
          <a-mixin id="bench" gltf-model="#benchmodel" scale="1 1 1"></a-mixin>
          <a-mixin id="track" gltf-model="#trackmodel" scale="1 1 1"></a-mixin>
          <a-mixin id="bikerack" gltf-model="#bikerackmodel" scale="0.25 0.25 0.25"></a-mixin>
          <a-mixin id="bikeshare" gltf-model="#bikesharemodel" scale="1 1 1"></a-mixin>
          <a-mixin id="lamp-modern" gltf-model="#lamp-modern-glb" scale="0.5 0.5 0.5"></a-mixin>
          <a-mixin id="lamp-traditional" gltf-model="#lamp-traditional-glb" scale="0.2 0.2 0.2" ></a-mixin>
          <a-mixin id="pride-flag" position="0.409 3.345 0" rotation="0 0 0" scale="0.5 0.75 0" geometry="width:2;height:2;primitive:plane" material="side:double; src:${assetUrl}assets/materials/rainbow-flag-poles_512.png;transparent: true;"></a-mixin>
          <a-mixin id="bus-stop" gltf-model="#bus-stop-glb" rotation="-90 0 0" scale="0.001 0.001 0.001" ></a-mixin>
          <a-mixin id="wayfinding-box" geometry="primitive: box; height: 2; width: 0.84; depth: 0.1" material="color: gray"></a-mixin>
  
          <!-- buildings and blocks -->
          <a-mixin id="block" gltf-model="#blockmodel" scale="1 1 1"></a-mixin>
          <a-mixin id="suburbia" gltf-model="#suburbiamodel" scale="1 1 1"></a-mixin>
  
          <a-mixin id="SM3D_Bld_Mixed_Corner_4fl" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #blockmodel; part: SM3D_Bld_Mixed_Corner_4fl" model-center="bottomAlign: true"></a-mixin>
          <a-mixin id="SM3D_Bld_Mixed_Double_5fl" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #blockmodel; part: SM3D_Bld_Mixed_Double_5fl" model-center="bottomAlign: true"></a-mixin>
          <a-mixin id="SM3D_Bld_Mixed_4fl_2" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #blockmodel; part: SM3D_Bld_Mixed_4fl_2" model-center="bottomAlign: true"></a-mixin>
          <a-mixin id="SM3D_Bld_Mixed_5fl" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #blockmodel; part: SM3D_Bld_Mixed_5fl" model-center="bottomAlign: true"></a-mixin>
          <a-mixin id="SM3D_Bld_Mixed_4fl" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #blockmodel; part: SM3D_Bld_Mixed_4fl" model-center="bottomAlign: true"></a-mixin>
  
          <a-mixin id="SM_Bld_House_Preset_03_1800" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #suburbiamodel; part: SM_Bld_House_Preset_03_1800" model-center="bottomAlign: true"></a-mixin>
          <a-mixin id="SM_Bld_House_Preset_08_1809" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #suburbiamodel; part: SM_Bld_House_Preset_08_1809" model-center="bottomAlign: true"></a-mixin>
          <a-mixin id="SM_Bld_House_Preset_09_1845" scale="1 1 1" rotation="0 0 0" gltf-part-plus="src: #suburbiamodel; part: SM_Bld_House_Preset_09_1845" model-center="bottomAlign: true"></a-mixin>
  
          <a-mixin id="seawall" gltf-model="#seawall-model" scale="1 1 1" rotation="0 0 0"></a-mixin>
          <a-mixin id="fence" gltf-model="#fence-model" scale="0.1 0.1 0.1"></a-mixin>
  
          <a-mixin id="ground-grass" rotation="-90 0 0" geometry="primitive:plane;height:150;width:150" material="src:url(${assetUrl}assets/materials/TexturesCom_Grass0052_1_seamless_S.jpg);repeat:5 5;roughness:1"></a-mixin>
          <a-mixin id="ground-parking-lot" rotation="-90 0 0" geometry="primitive:plane;height:150;width:150" material="src:url(${assetUrl}assets/materials/TexturesCom_Roads0111_1_seamless_S.jpg);repeat:2 4;roughness:1"></a-mixin>
          <a-mixin id="ground-asphalt" rotation="-90 0 0" geometry="primitive:plane;height:150;width:150" material="src:url(${assetUrl}assets/materials/TexturesCom_AsphaltDamaged0057_1_seamless_S.jpg);repeat:5 5;roughness:1"></a-mixin>
  
          <!-- ui / future use -->
          <image id="subtitle" src="${assetUrl}assets/materials/subtitle.png" />
  `;

  // insert the streetmix assets into the asset section
  assets.insertAdjacentHTML('beforeend', assetsInnerHTML);
});



/*
Unused assets kept commented here for future reference
        <!-- sky - equirectangular still used for envmap -->
        <!-- <img id="sky" position="0 -140 0" src="assets/CGSkies_0343_doubled_2048.jpg" crossorigin="anonymous" /> -->

        <!-- raw photogrammetry textures - unused by default -->
        <a-mixin id="bike-lane-t0" geometry="width:1.8;height:150;primitive:plane" material="repeat:2 150;src:assets/materials/bikelane_Base_Color.jpg;normalTextureRepeat:2 150;normalMap:assets/materials/bikelane_Normal.jpg"></a-mixin>
        <a-mixin id="sidewalk-t0" geometry="width:3;height:150;primitive:plane" material="repeat:1.5 75;src:assets/materials/sidewalkhd_Base_Color.jpg;normalTextureRepeat:1.5 75;normalMap:assets/materials/sidewalkhd_Normal.jpg;"></a-mixin>
        <a-mixin id="drive-lane-t0" geometry="width:3;height:150;primitive:plane" material="repeat:1.5 75;src:assets/materials/asphalthd_Base_Color.jpg;normalTextureRepeat:1.5 75;normalMap:assets/materials/asphalthd_Normal.jpg;"></a-mixin>
        <a-mixin id="bus-lane-t0" geometry="width:3;height:150;primitive:plane" material="repeat:1.5 75;src:assets/materials/asphaltred1hd_Base_Color.jpg;normalTextureRepeat:1.5 75;normalMap:assets/materials/asphaltred1hd_Normal.jpg;"></a-mixin>
*/
