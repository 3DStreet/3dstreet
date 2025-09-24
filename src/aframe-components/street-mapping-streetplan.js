// StreetPlan Mapping Constants

// Material mapping from Streetplan to 3DStreet surfaces
const STREETPLAN_MATERIAL_MAPPING = {
  'asphalt black': { surface: 'asphalt', color: '#aaaaaa' },
  'asphalt blue': { surface: 'asphalt', color: '#aaaaff' },
  'asphalt red 1': { surface: 'asphalt', color: '#ffaaaa' },
  'asphalt red 2': { surface: 'asphalt', color: '#ff0000' },
  'asphalt green': { surface: 'asphalt', color: '#aaffaa' },
  'asphalt old': { surface: 'asphalt' },
  'standard concrete': { surface: 'concrete' },
  grass: { surface: 'grass' },
  'grass dead': { surface: 'grass' },
  'pavers tan': { surface: 'sidewalk' },
  'pavers brown': { surface: 'sidewalk' },
  'pavers mixed': { surface: 'sidewalk' },
  'pavers red': { surface: 'sidewalk', color: '#ffaaaa' },
  'tint conc. or dirt': { surface: 'gravel' },
  dirt: { surface: 'gravel' },
  gravel: { surface: 'gravel' },
  stonetan: { surface: 'sidewalk' },
  'sidewalk 2': { surface: 'sidewalk' },
  'cobble stone': { surface: 'sidewalk' },
  'solid black': { surface: 'solid' },
  'painted intersection': { surface: 'asphalt' },
  'grass with edging': { surface: 'grass' },
  xeriscape: { surface: 'grass' },
  'grassslopemedian 12ft': { surface: 'grass' },
  'grassslopemedian 24ft': { surface: 'grass' },
  'grassslope 12ft-left': { surface: 'grass' },
  'grassslope 12ft-right': { surface: 'grass' },
  'grassslope 24ft-left': { surface: 'grass' },
  'grassslope 24ft-right': { surface: 'grass' },
  sand: { surface: 'sand' }
};

// StreetPlan O-Tags objects (Name-01, etc.) to generated clones mapping
const STREETPLAN_OBJECT_TO_GENERATED_CLONES_MAPPING = {
  'apron 2ft, left': '',
  'apron 2ft, right': '',
  'barrier 1-ft': {
    mode: 'fixed',
    modelsArray:
      'temporary-jersey-barrier-concrete,temporary-jersey-barrier-concrete',
    spacing: 50
  },
  'barrier 2-ft': {
    mode: 'fixed',
    modelsArray:
      'temporary-jersey-barrier-concrete,temporary-jersey-barrier-concrete',
    spacing: 50
  },
  'bollard plastic yellow': {
    mode: 'fixed',
    modelsArray: 'bollard,bollard',
    spacing: 50
  },
  'curb edge: 0.5 ft': '',
  fence: '',
  'grassmound (10ft)': '',
  'grassmound (12ft)': '',
  'grassmound (4ft)': '',
  'grassmound (6ft)': '',
  'grassmound (8ft)': '',
  'gutter 2 narrow': '',
  'gutter rolling 2.5 ft, left': '',
  'gutter rolling 2.5 ft, right': '',
  'gutter std. 2.5 ft, left': '',
  'gutter std. 2.5 ft, right': '',
  'materials grassslope (12ft)': '',
  'materials grassslope (24ft)': '',
  'materials grassslope rev (12ft)': '',
  'materials grassslope rev (24ft)': '',
  'mountable barrier 1-ft': '',
  'orange barrel': {
    mode: 'fixed',
    modelsArray: 'temporary-traffic-cone,temporary-traffic-cone',
    spacing: 50
  },
  'slopedgrass 40ft': '',
  'soundwall (12ft)': '',
  'soundwall (8ft)': '',
  'soundwall plants (12ft)': '',
  'soundwall plants (8ft)': '',
  'bench old': {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4
  },
  'bench simple': {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4
  },
  'bikerack bollard': {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4
  },
  'blue mailbox': {
    mode: 'random',
    modelsArray: 'USPS-mailbox,bikerack,sp-furn-bench2-5x2ft',
    spacing: 20,
    count: 3
  },
  'boxwood planter 2ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush,dividers-bush',
    spacing: 50
  },
  'boxwood planter 3ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush,dividers-bush',
    spacing: 50
  },
  'flower pot 4ft': '',
  garbagecan: {
    mode: 'random',
    modelsArray: 'trash-bin,sp-furn-table-2x7ft,sideview',
    spacing: 10,
    count: 3
  },
  'nyc bike rack': {
    mode: 'random',
    modelsArray: 'trash-bin,sp-furn-table-2x7ft,sideview',
    spacing: 10,
    count: 3
  },
  'planter flowers': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 5,
    count: 20
  },
  'random trashcan': {
    mode: 'random',
    modelsArray: 'trash-bin,sp-furn-table-2x7ft,sideview',
    spacing: 10,
    count: 3
  },
  shelter: {
    mode: 'random',
    modelsArray:
      'sp-furn-busstop-shelter-12x4ft,trash-bin,sp-furn-foodcart-5dot5x9ft',
    spacing: 10,
    count: 3
  },
  'table small 3ft': {
    mode: 'random',
    modelsArray: 'sp-furn-table-2x7ft,trash-bin,USPS-mailbox,bikerack',
    spacing: 10,
    count: 4
  },
  tallgrass: {
    mode: 'fixed',
    modelsArray: 'dividers-bush,dividers-bush',
    spacing: 50
  },
  'tallgrass 40ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush,dividers-bush',
    spacing: 50
  },
  trashcan: {
    mode: 'random',
    modelsArray: 'trash-bin,sp-furn-table-2x7ft,sideview',
    spacing: 10,
    count: 3
  },
  'bike food cart': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-busstop-shelter-12x4ft,sp-furn-bench2-5x2ft,sp-furn-table-blue-7x7ft',
    spacing: 10,
    count: 4
  },
  'boxwood planter 5ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush,dividers-bush',
    spacing: 50
  },
  'fleamarket stuff': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-farmertent1-10x10ft,sp-furn-sp-furn-farmertent2-10x10ft,sp-furn-table-blue-7x7ft',
    spacing: 10,
    count: 4
  },
  'hot dog cart': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-busstop-shelter-12x4ft,sp-furn-bench2-5x2ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4
  },
  'large food cart': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-busstop-shelter-12x4ft,sp-furn-bench2-5x2ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4
  },
  'planter with bench': {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4
  },
  'shelter roundroof': {
    mode: 'random',
    modelsArray:
      'sp-furn-busstop-roundshelter-12x13ft,trash-bin,sp-furn-foodcart-5dot5x9ft',
    spacing: 10,
    count: 3
  },
  sideview: {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4
  },
  'sideview modern': {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4
  },
  table: {
    mode: 'fixed',
    modelsArray: 'sp-furn-foodcart-5dot5x9ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 2
  },
  'tent bluewhite': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-farmertent1-10x10ft,sp-furn-sp-furn-farmertent2-10x10ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4
  },
  'tent veggie': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-farmertent1-10x10ft,sp-furn-sp-furn-farmertent2-10x10ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4
  },
  'brick apartment 1floor': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'brick apartment 2floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'brick apartment 3floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'brick apartment 4floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'brick apartment 5floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building blue 1floor': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building blue 2floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building blue 3floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building blue 4floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building blue 5floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building blue 6floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building blue 7floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building yellow 1floor': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building yellow 2floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building yellow 3floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building yellow 4floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building yellow 5floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building yellow 6floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'building yellow 7floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'buildings falltrees (30ft)': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'buildings pinetrees (30ft)': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'gas station': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'home depot': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'house 1floor': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'house 2floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'house 3floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'house 4floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'house 5floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'house newurbanist': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'house newurbanist red': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'live work': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mart chilis': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mikedesign midvale 2story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mikedesign midvale 3story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mikedesign midvale3 3story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mixed use 2floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mixed use 3floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mixed use 4floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'mixed use 5floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'nice apartment 3story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'nice apartment 4story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'nice apartment 5story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'nice apartment 6story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'red mixed use 1floor': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'red mixed use 2floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'red mixed use 3floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'red mixed use 4floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'red mixed use 5floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  residential: {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'river crosssection': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'river crosssection 20ft': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'river crosssection 40ft': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'shop 1floor': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'shop 2floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'shop 3floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'shop 4floors': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'single family': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'single family back': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'stripmall onerowparking': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'stripmall1 tworowsparking': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'stripmall1, onerowparking': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'stripmall2 tworowsparking': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'townhouse row 3story': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  walmart: {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'water 20ft': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'water 30ft': {
    mode: 'random',
    modelsArray:
      'v2-buildings-suburban-SM_Bld_House_Preset_09_1845,v2-buildings-suburban-SM_Bld_House_Preset_03_1800',
    spacing: 10,
    count: 2
  },
  'blank pedrefuge (8ft)': '',
  'cactus median (10ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'cactus median (12ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'cactus median (4ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'cactus median (6ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'cactus median (8ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'flower median (10ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'flower median (12ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'flower median (4ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'flower median (6ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'flower median (8ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'flowers pedrefuge (8ft)': '',
  'grassslopemedian (12ft)': '',
  'grassslopemedian (24ft)': '',
  'grassy median (10ft)': '',
  'grassy median (12ft)': '',
  'grassy median (4ft)': '',
  'grassy median (6ft)': '',
  'grassy median (8ft)': '',
  'rock median (10ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'rock median (12ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'rock median (4ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'rock median (6ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'rock median (8ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'tallplantbox (10ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'tallplantbox (12ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'tallplantbox (4ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'tallplantbox (6ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'tallplantbox (8ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'tallplantbox pedref (10ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'tallplantbox pedref (12ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-10x30ft,sp-median-planterbox-tall-10x30ft',
    spacing: 50
  },
  'tallplantbox pedref (6ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'tallplantbox pedref (8ft)': {
    mode: 'fixed',
    modelsArray:
      'sp-median-planterbox-tall-06x30ft,sp-median-planterbox-tall-06x30ft',
    spacing: 50
  },
  'tropical median (4ft)': '',
  'weeds median (4ft)': '',
  'weeds median (6ft)': '',
  'weeds median (8ft)': '',
  'away, left park, back in': '',
  'away, left park, head in': '',
  'away, right park, back in': '',
  'away, right park, head in': '',
  'bluecar parallelpark': '',
  'bulb out parking': '',
  'camptrailer sideview 33ft': '',
  foodtruck: '',
  'nev angle parking': '',
  'nev park wheelchair': '',
  'nev perp park': '',
  'parallel pedbulbout': {
    mode: 'fixed',
    modelsArray: 'sp-parking-planter-5x8ft,sp-parking-planter-5x8ft',
    spacing: 50
  },
  'parallel redvan': '',
  'parallel yellowcar': '',
  parklet: '',
  'pickup sideview 20ft': '',
  'purpendicular left side, blue': '',
  'purpendicular left side, red': '',
  'purpendicular right side, blue': '',
  'purpendicular right side, red': '',
  'semitruck sideview 70ft': '',
  smartcar: '',
  'smartcar 5ft': '',
  'smartcar 5ft rev': '',
  'smartcar perpendicular': '',
  'toward, left park, back in': '',
  'toward, left park, head in': '',
  'toward, right park, back in': '',
  'toward, right park, head in': '',
  'truck fedex sideview': '',
  'atv off highway': '',
  'bike rider': {
    mode: 'fixed',
    modelsArray: 'bicycle_1,bicycle_1',
    spacing: 50
  },
  'bike rider rev': {
    mode: 'fixed',
    modelsArray: 'bicycle_1,bicycle_1',
    spacing: 50
  },
  'bikelane sharecar': '',
  'bikelane sharecar rev': '',
  'casual woman': {
    mode: 'fixed',
    modelsArray: 'bicycle_1,bicycle_1',
    spacing: 50
  },
  'casual woman 2': {
    mode: 'fixed',
    modelsArray: 'cyclist3,cyclist3',
    spacing: 50
  },
  'casual woman 2 rev': {
    mode: 'fixed',
    modelsArray: 'cyclist-dutch,cyclist-dutch',
    spacing: 50
  },
  'couple biking': '',
  'couple jogging': '',
  'golfcart red 4ft back': '',
  'golfcart red 4ft front': '',
  'horserider and jogging': '',
  'horserider coming': '',
  'horserider going': '',
  'horseridergoing and coming': '',
  'jogging and biking': '',
  'kid biking': {
    mode: 'fixed',
    modelsArray: 'cyclist-kid,cyclist-kid',
    spacing: 50
  },
  'multi use trail 12ft': '',
  'nev and bike 10ft': '',
  'nev shuttle back': '',
  'nev shuttle front': '',
  'nev two passing 12ft': '',
  'offroad large back 6ft': '',
  'offroad large front 6ft': '',
  'offroad two vehicles 11ft': '',
  'polaris gem e4': '',
  scooter: {
    mode: 'fixed',
    modelsArray: 'cyclist-cargo,cyclist-cargo',
    spacing: 50
  },
  'serious man': {
    mode: 'fixed',
    modelsArray: 'cyclist2,cyclist2',
    spacing: 50
  },
  'serious man rev': {
    mode: 'fixed',
    modelsArray: 'cyclist2,cyclist2',
    spacing: 50
  },
  smallnev: '',
  smallscooter: {
    mode: 'fixed',
    modelsArray: 'electricscooter_1,electricscooter_1',
    spacing: 50
  },
  'two bikes back': '',
  'two bikes come and go': '',
  'widebikepath twosides': '',
  'woman bike': {
    mode: 'fixed',
    modelsArray: 'cyclist-dutch,cyclist-dutch',
    spacing: 50
  },
  'woman jogging': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  '2 people': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
    spacing: 15,
    count: 10
  },
  '3 people': {
    mode: 'random',
    modelsArray: 'a_char2,a_char4,a_char6,a_char8',
    spacing: 15,
    count: 10
  },
  couple: {
    mode: 'random',
    modelsArray: 'char2,char4,char6,char8',
    spacing: 15,
    count: 10
  },
  'dog walker': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'grandpa and todler': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
    spacing: 15,
    count: 10
  },
  'lady crossing street': {
    mode: 'random',
    modelsArray: 'a_char2,a_char4,a_char6,a_char8',
    spacing: 15,
    count: 10
  },
  man: {
    mode: 'random',
    modelsArray: 'char2,char4,char6,char8',
    spacing: 15,
    count: 10
  },
  'man and girl': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'man come': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
    spacing: 15,
    count: 10
  },
  'man come rev': {
    mode: 'random',
    modelsArray: 'a_char2,a_char4,a_char6,a_char8',
    spacing: 15,
    count: 10
  },
  'man go': {
    mode: 'random',
    modelsArray: 'char2,char4,char6,char8',
    spacing: 15,
    count: 10
  },
  'man go rev': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'man jogging': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
    spacing: 15,
    count: 10
  },
  'man walking': {
    mode: 'random',
    modelsArray: 'a_char2,a_char4,a_char6,a_char8',
    spacing: 15,
    count: 10
  },
  'older couple': {
    mode: 'random',
    modelsArray: 'char2,char4,char6,char8',
    spacing: 15,
    count: 10
  },
  'older ladies walking': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'older man walking': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
    spacing: 15,
    count: 10
  },
  'small girl': {
    mode: 'random',
    modelsArray: 'a_char2,a_char4,a_char6,a_char8',
    spacing: 15,
    count: 10
  },
  'wheel chair': {
    mode: 'random',
    modelsArray: 'char2,char4,char6,char8',
    spacing: 15,
    count: 10
  },
  'woman back': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'woman in hat': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
    spacing: 15,
    count: 10
  },
  'woman shopping': {
    mode: 'random',
    modelsArray: 'a_char2,a_char4,a_char6,a_char8',
    spacing: 15,
    count: 10
  },
  'woman walking': {
    mode: 'random',
    modelsArray: 'char2,char4,char6,char8',
    spacing: 15,
    count: 10
  },
  'young woman walking': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'cobra light': {
    mode: 'fixed',
    modelsArray: 'lamp-modern,lamp-modern',
    spacing: 50
  },
  'hawk signal narrow': {
    mode: 'fixed',
    modelsArray: 'signal_right,signal_right',
    spacing: 50
  },
  'hawk signal wide': {
    mode: 'fixed',
    modelsArray: 'signal_right,signal_right',
    spacing: 50
  },
  'hawk signal xwide': {
    mode: 'fixed',
    modelsArray: 'signal_right,signal_right',
    spacing: 50
  },
  'historic light': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional,lamp-traditional',
    spacing: 50
  },
  'historic no banner': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional,lamp-traditional',
    spacing: 50
  },
  'historic with banners': {
    mode: 'fixed',
    modelsArray:
      'sp-light-flowerp-bannerby-13ft,sp-light-flowerp-bannerby-13ft',
    spacing: 50
  },
  'historic with flowers 1': {
    mode: 'fixed',
    modelsArray:
      'sp-light-flowerp-bannerby-13ft,sp-light-flowerp-bannerby-13ft',
    spacing: 50
  },
  'historic with flowers 2': {
    mode: 'fixed',
    modelsArray:
      'sp-light-flowery-bannerrg-13ft,sp-light-flowery-bannerrg-13ft',
    spacing: 50
  },
  'light rail poles': '',
  'power tower 30ft': '',
  'street light': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional,lamp-traditional',
    spacing: 50
  },
  'streetlight solar': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional,lamp-traditional',
    spacing: 50
  },
  'streetlight solar banners 1': {
    mode: 'fixed',
    modelsArray:
      'sp-light-flowerp-bannerby-13ft,sp-light-flowerp-bannerby-13ft',
    spacing: 50
  },
  'streetlight solar banners 2': {
    mode: 'fixed',
    modelsArray:
      'sp-light-flowery-bannerrg-13ft,sp-light-flowery-bannerrg-13ft',
    spacing: 50
  },
  'telephone pole': {
    mode: 'fixed',
    modelsArray: 'utility_pole,utility_pole',
    spacing: 50
  },
  'billboard sign': '',
  brickpillar: '',
  'countrymile sign': '',
  'motel sign': '',
  'shop united sign': '',
  'sign directory': {
    mode: 'fixed',
    modelsArray: 'wayfinding-box,wayfinding-box',
    spacing: 50
  },
  'stroad sign landr 16ft': '',
  'used cars sign': '',
  usedcars: '',
  'vivo sign': '',
  '10 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-10mph,sp-sign-speed-limit-10mph',
    spacing: 50
  },
  '10 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-10mph,sp-sign-speed-limit-10mph',
    spacing: 50
  },
  '12 mph': '',
  '12 mph nopole': '',
  '15 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-15mph,sp-sign-speed-limit-15mph',
    spacing: 50
  },
  '15 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-15mph,sp-sign-speed-limit-15mph',
    spacing: 50
  },
  '20 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-20mph,sp-sign-speed-limit-20mph',
    spacing: 50
  },
  '20 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-20mph,sp-sign-speed-limit-20mph',
    spacing: 50
  },
  '25 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-25mph,sp-sign-speed-limit-25mph',
    spacing: 50
  },
  '25 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-25mph,sp-sign-speed-limit-25mph',
    spacing: 50
  },
  '30 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-30mph,sp-sign-speed-limit-30mph',
    spacing: 50
  },
  '30 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-30mph,sp-sign-speed-limit-30mph',
    spacing: 50
  },
  '35 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-35mph,sp-sign-speed-limit-35mph',
    spacing: 50
  },
  '35 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-35mph,sp-sign-speed-limit-35mph',
    spacing: 50
  },
  '40 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-40mph,sp-sign-speed-limit-40mph',
    spacing: 50
  },
  '40 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-40mph,sp-sign-speed-limit-40mph',
    spacing: 50
  },
  '45 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-45mph,sp-sign-speed-limit-45mph',
    spacing: 50
  },
  '45 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-45mph,sp-sign-speed-limit-45mph',
    spacing: 50
  },
  '50 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-50mph,sp-sign-speed-limit-50mph',
    spacing: 50
  },
  '50 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-50mph,sp-sign-speed-limit-50mph',
    spacing: 50
  },
  '55 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-55mph,sp-sign-speed-limit-55mph',
    spacing: 50
  },
  '55 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-55mph,sp-sign-speed-limit-55mph',
    spacing: 50
  },
  '60 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-60mph,sp-sign-speed-limit-60mph',
    spacing: 50
  },
  '60 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-60mph,sp-sign-speed-limit-60mph',
    spacing: 50
  },
  '65 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-65mph,sp-sign-speed-limit-65mph',
    spacing: 50
  },
  '65 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-65mph,sp-sign-speed-limit-65mph',
    spacing: 50
  },
  '70 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-70mph,sp-sign-speed-limit-70mph',
    spacing: 50
  },
  '70 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-70mph,sp-sign-speed-limit-70mph',
    spacing: 50
  },
  '75 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-75mph,sp-sign-speed-limit-75mph',
    spacing: 50
  },
  '75 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-75mph,sp-sign-speed-limit-75mph',
    spacing: 50
  },
  '80 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-80mph,sp-sign-speed-limit-80mph',
    spacing: 50
  },
  '80 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-80mph,sp-sign-speed-limit-80mph',
    spacing: 50
  },
  boulevardcirculator: {
    mode: 'fixed',
    modelsArray: 'minibus,minibus',
    spacing: 50
  },
  'boulevardcirculator rev': {
    mode: 'fixed',
    modelsArray: 'minibus,minibus',
    spacing: 50
  },
  bus: { mode: 'fixed', modelsArray: 'bus,bus', spacing: 50 },
  'bus rev': { mode: 'fixed', modelsArray: 'bus,bus', spacing: 50 },
  'heavy rail': '',
  'heavy rail rev': '',
  'streetcar blue': {
    mode: 'fixed',
    modelsArray: 'trolley,trolley',
    spacing: 50
  },
  'streetcar blue rev': {
    mode: 'fixed',
    modelsArray: 'trolley,trolley',
    spacing: 50
  },
  'streetcar red 1': {
    mode: 'fixed',
    modelsArray: 'trolley,trolley',
    spacing: 50
  },
  'streetcar red 1 rev': {
    mode: 'fixed',
    modelsArray: 'trolley,trolley',
    spacing: 50
  },
  'streetcar red 2': {
    mode: 'fixed',
    modelsArray: 'trolley,trolley',
    spacing: 50
  },
  'streetcar red 2 rev': {
    mode: 'fixed',
    modelsArray: 'trolley,trolley',
    spacing: 50
  },
  'streetcar yellow': {
    mode: 'fixed',
    modelsArray: 'trolley,trolley',
    spacing: 50
  },
  'uta bus': { mode: 'fixed', modelsArray: 'bus,bus', spacing: 50 },
  'uta lightrail': { mode: 'fixed', modelsArray: 'tram,tram', spacing: 50 },
  'uta lightrail rev': { mode: 'fixed', modelsArray: 'tram,tram', spacing: 50 },
  'bur oak': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-24ft,sp-tree-buroak-24ft',
    spacing: 50
  },
  'desertwillow texas': {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft,sp-tree-honeylocust-24ft',
    spacing: 50
  },
  'english oak': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft,sp-tree-buroak-28ft',
    spacing: 50
  },
  'floweringpear 18ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft,sp-tree-purpleplum-16ft',
    spacing: 50
  },
  goldenraintree: {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft,sp-tree-honeylocust-24ft',
    spacing: 50
  },
  honeylocust: {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft,sp-tree-honeylocust-24ft',
    spacing: 50
  },
  'japanese lilac': {
    mode: 'fixed',
    modelsArray: 'sp-tree-japaneselilac-20ft,sp-tree-japaneselilac-20ft',
    spacing: 50
  },
  'japanese zelkova': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft,sp-tree-buroak-28ft',
    spacing: 50
  },
  'jerusalem thorn': {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft,sp-tree-honeylocust-24ft',
    spacing: 50
  },
  'kentucky coffeetree': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft,sp-tree-buroak-28ft',
    spacing: 50
  },
  'large oak': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft,sp-tree-buroak-28ft',
    spacing: 50
  },
  'palm tree': {
    mode: 'fixed',
    modelsArray: 'sp-tree-palm-26ft,sp-tree-palm-26ft',
    spacing: 50
  },
  'palmtree 20ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-palm-26ft,sp-tree-palm-26ft',
    spacing: 50
  },
  'palmtree 28ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-palm-28ft,sp-tree-palm-28ft',
    spacing: 50
  },
  'pine tree': '',
  'pink flower 16ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft,sp-tree-purpleplum-16ft',
    spacing: 50
  },
  'purpleleaf plum': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft,sp-tree-purpleplum-16ft',
    spacing: 50
  },
  'red berries 14ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft,sp-tree-purpleplum-16ft',
    spacing: 50
  },
  'small tree': {
    mode: 'fixed',
    modelsArray: 'sp-tree-small-15ft,sp-tree-small-15ft',
    spacing: 50
  },
  'blue car': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'blue car rev': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'blue truck': '',
  'blue truck rev': '',
  'dump truck': '',
  'dump truck rev': '',
  'green car': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'green car rev': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'moto highway rider': {
    mode: 'fixed',
    modelsArray: 'tuk-tukmotorbike,tuk-tukmotorbike',
    spacing: 50
  },
  'moto highway rider rev': {
    mode: 'fixed',
    modelsArray: 'tuk-tukmotorbike,tuk-tukmotorbike',
    spacing: 50
  },
  'orange truck': '',
  'orange truck rev': '',
  'red car': { mode: 'fixed', modelsArray: 'sedan-rig,sedan-rig', spacing: 50 },
  'red car rev': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'red jeep': '',
  'red jeep rev': '',
  'semi truck': '',
  'semi truck rev': '',
  'silver suv': { mode: 'fixed', modelsArray: 'suv-rig,suv-rig', spacing: 50 },
  'silver suv rev': {
    mode: 'fixed',
    modelsArray: 'suv-rig,suv-rig',
    spacing: 50
  },
  truck: '',
  'truck fedex': {
    mode: 'fixed',
    modelsArray: 'box-truck-rig,box-truck-rig',
    spacing: 50
  },
  'truck fedex rev': {
    mode: 'fixed',
    modelsArray: 'box-truck-rig,box-truck-rig',
    spacing: 50
  },
  'truck ups': {
    mode: 'fixed',
    modelsArray: 'box-truck-rig,box-truck-rig',
    spacing: 50
  },
  'truck ups rev': {
    mode: 'fixed',
    modelsArray: 'box-truck-rig,box-truck-rig',
    spacing: 50
  },
  'two cars passing': '',
  'white coup': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'white coup rev': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'white sedan': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'white sedan rev': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'white truck': '',
  'white truck rev': '',
  'yellow sedan': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'yellow sedan rev': {
    mode: 'fixed',
    modelsArray: 'sedan-rig,sedan-rig',
    spacing: 50
  },
  'empty path': '',
  'empty place holder': '',
  narrow: '',
  'no sign': '',
  wide: ''
};

export {
  STREETPLAN_MATERIAL_MAPPING,
  STREETPLAN_OBJECT_TO_GENERATED_CLONES_MAPPING
};
