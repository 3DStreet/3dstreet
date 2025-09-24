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
  'barrier 1-ft': 'temporary-jersey-barrier-concrete',
  'barrier 2-ft': 'temporary-jersey-barrier-concrete',
  'bollard plastic yellow': 'bollard',
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
  'orange barrel': 'temporary-traffic-cone',
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
  'boxwood planter 2ft': 'dividers-bush',
  'boxwood planter 3ft': 'dividers-bush',
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
    count: 2
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
  tallgrass: 'dividers-bush',
  'tallgrass 40ft': 'dividers-bush',
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
  'boxwood planter 5ft': 'dividers-bush',
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
  'cactus median (10ft)': 'sp-median-planterbox-tall-10x30ft',
  'cactus median (12ft)': 'sp-median-planterbox-tall-10x30ft',
  'cactus median (4ft)': 'sp-median-planterbox-tall-06x30ft',
  'cactus median (6ft)': 'sp-median-planterbox-tall-06x30ft',
  'cactus median (8ft)': 'sp-median-planterbox-tall-06x30ft',
  'flower median (10ft)': 'sp-median-planterbox-tall-10x30ft',
  'flower median (12ft)': 'sp-median-planterbox-tall-10x30ft',
  'flower median (4ft)': 'sp-median-planterbox-tall-06x30ft',
  'flower median (6ft)': 'sp-median-planterbox-tall-06x30ft',
  'flower median (8ft)': 'sp-median-planterbox-tall-06x30ft',
  'flowers pedrefuge (8ft)': '',
  'grassslopemedian (12ft)': '',
  'grassslopemedian (24ft)': '',
  'grassy median (10ft)': '',
  'grassy median (12ft)': '',
  'grassy median (4ft)': '',
  'grassy median (6ft)': '',
  'grassy median (8ft)': '',
  'rock median (10ft)': 'sp-median-planterbox-tall-10x30ft',
  'rock median (12ft)': 'sp-median-planterbox-tall-10x30ft',
  'rock median (4ft)': 'sp-median-planterbox-tall-06x30ft',
  'rock median (6ft)': 'sp-median-planterbox-tall-06x30ft',
  'rock median (8ft)': 'sp-median-planterbox-tall-06x30ft',
  'tallplantbox (10ft)': 'sp-median-planterbox-tall-10x30ft',
  'tallplantbox (12ft)': 'sp-median-planterbox-tall-10x30ft',
  'tallplantbox (4ft)': 'sp-median-planterbox-tall-06x30ft',
  'tallplantbox (6ft)': 'sp-median-planterbox-tall-06x30ft',
  'tallplantbox (8ft)': 'sp-median-planterbox-tall-06x30ft',
  'tallplantbox pedref (10ft)': 'sp-median-planterbox-tall-10x30ft',
  'tallplantbox pedref (12ft)': 'sp-median-planterbox-tall-10x30ft',
  'tallplantbox pedref (6ft)': 'sp-median-planterbox-tall-06x30ft',
  'tallplantbox pedref (8ft)': 'sp-median-planterbox-tall-06x30ft',
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
  'parallel pedbulbout': 'sp-parking-planter-5x8ft',
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
  'bike rider': 'bicycle_1',
  'bike rider rev': 'bicycle_1',
  'bikelane sharecar': '',
  'bikelane sharecar rev': '',
  'casual woman': 'bicycle_1',
  'casual woman 2': 'cyclist3',
  'casual woman 2 rev': 'cyclist-dutch',
  'couple biking': '',
  'couple jogging': '',
  'golfcart red 4ft back': '',
  'golfcart red 4ft front': '',
  'horserider and jogging': '',
  'horserider coming': '',
  'horserider going': '',
  'horseridergoing and coming': '',
  'jogging and biking': '',
  'kid biking': 'cyclist-kid',
  'multi use trail 12ft': '',
  'nev and bike 10ft': '',
  'nev shuttle back': '',
  'nev shuttle front': '',
  'nev two passing 12ft': '',
  'offroad large back 6ft': '',
  'offroad large front 6ft': '',
  'offroad two vehicles 11ft': '',
  'polaris gem e4': '',
  scooter: 'cyclist-cargo',
  'serious man': 'cyclist2',
  'serious man rev': 'cyclist2',
  smallnev: '',
  smallscooter: 'electricscooter_1',
  'two bikes back': '',
  'two bikes come and go': '',
  'widebikepath twosides': '',
  'woman bike': 'cyclist-dutch',
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
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  couple: {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
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
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  man: {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
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
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'man go': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
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
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'older couple': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
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
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'wheel chair': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
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
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'woman walking': {
    mode: 'random',
    modelsArray: 'char1,char3,char5,char7',
    spacing: 15,
    count: 10
  },
  'young woman walking': {
    mode: 'random',
    modelsArray: 'a_char1,a_char3,a_char5,a_char7',
    spacing: 15,
    count: 10
  },
  'cobra light': 'lamp-modern',
  'hawk signal narrow': 'signal_right',
  'hawk signal wide': 'signal_right',
  'hawk signal xwide': 'signal_right',
  'historic light': 'lamp-traditional',
  'historic no banner': 'lamp-traditional',
  'historic with banners': 'sp-light-flowerp-bannerby-13ft',
  'historic with flowers 1': 'sp-light-flowerp-bannerby-13ft',
  'historic with flowers 2': 'sp-light-flowery-bannerrg-13ft',
  'light rail poles': '',
  'power tower 30ft': '',
  'street light': 'lamp-traditional',
  'streetlight solar': 'lamp-traditional',
  'streetlight solar banners 1': 'sp-light-flowerp-bannerby-13ft',
  'streetlight solar banners 2': 'sp-light-flowery-bannerrg-13ft',
  'telephone pole': 'utility_pole',
  'billboard sign': '',
  brickpillar: '',
  'countrymile sign': '',
  'motel sign': '',
  'shop united sign': '',
  'sign directory': 'wayfinding-box',
  'stroad sign landr 16ft': '',
  'used cars sign': '',
  usedcars: '',
  'vivo sign': '',
  '10 mph': 'sp-sign-speed-limit-10mph',
  '10 mph nopole': 'sp-sign-speed-limit-10mph',
  '12 mph': '',
  '12 mph nopole': '',
  '15 mph': 'sp-sign-speed-limit-15mph',
  '15 mph nopole': 'sp-sign-speed-limit-15mph',
  '20 mph': 'sp-sign-speed-limit-20mph',
  '20 mph nopole': 'sp-sign-speed-limit-20mph',
  '25 mph': 'sp-sign-speed-limit-25mph',
  '25 mph nopole': 'sp-sign-speed-limit-25mph',
  '30 mph': 'sp-sign-speed-limit-30mph',
  '30 mph nopole': 'sp-sign-speed-limit-30mph',
  '35 mph': 'sp-sign-speed-limit-35mph',
  '35 mph nopole': 'sp-sign-speed-limit-35mph',
  '40 mph': 'sp-sign-speed-limit-40mph',
  '40 mph nopole': 'sp-sign-speed-limit-40mph',
  '45 mph': 'sp-sign-speed-limit-45mph',
  '45 mph nopole': 'sp-sign-speed-limit-45mph',
  '50 mph': 'sp-sign-speed-limit-50mph',
  '50 mph nopole': 'sp-sign-speed-limit-50mph',
  '55 mph': 'sp-sign-speed-limit-55mph',
  '55 mph nopole': 'sp-sign-speed-limit-55mph',
  '60 mph': 'sp-sign-speed-limit-60mph',
  '60 mph nopole': 'sp-sign-speed-limit-60mph',
  '65 mph': 'sp-sign-speed-limit-65mph',
  '65 mph nopole': 'sp-sign-speed-limit-65mph',
  '70 mph': 'sp-sign-speed-limit-70mph',
  '70 mph nopole': 'sp-sign-speed-limit-70mph',
  '75 mph': 'sp-sign-speed-limit-75mph',
  '75 mph nopole': 'sp-sign-speed-limit-75mph',
  '80 mph': 'sp-sign-speed-limit-80mph',
  '80 mph nopole': 'sp-sign-speed-limit-80mph',
  boulevardcirculator: 'minibus',
  'boulevardcirculator rev': 'minibus',
  bus: 'bus',
  'bus rev': 'bus',
  'heavy rail': '',
  'heavy rail rev': '',
  'streetcar blue': 'trolley',
  'streetcar blue rev': 'trolley',
  'streetcar red 1': 'trolley',
  'streetcar red 1 rev': 'trolley',
  'streetcar red 2': 'trolley',
  'streetcar red 2 rev': 'trolley',
  'streetcar yellow': 'trolley',
  'uta bus': 'bus',
  'uta lightrail': 'tram',
  'uta lightrail rev': 'tram',
  'bur oak': 'sp-tree-buroak-24ft',
  'desertwillow texas': 'sp-tree-honeylocust-24ft',
  'english oak': 'sp-tree-buroak-28ft',
  'floweringpear 18ft': 'sp-tree-purpleplum-16ft',
  goldenraintree: 'sp-tree-honeylocust-24ft',
  honeylocust: 'sp-tree-honeylocust-24ft',
  'japanese lilac': 'sp-tree-japaneselilac-20ft',
  'japanese zelkova': 'sp-tree-buroak-28ft',
  'jerusalem thorn': 'sp-tree-honeylocust-24ft',
  'kentucky coffeetree': 'sp-tree-buroak-28ft',
  'large oak': 'sp-tree-buroak-28ft',
  'palm tree': 'sp-tree-palm-26ft',
  'palmtree 20ft': 'sp-tree-palm-26ft',
  'palmtree 28ft': 'sp-tree-palm-28ft',
  'pine tree': '',
  'pink flower 16ft': 'sp-tree-purpleplum-16ft',
  'purpleleaf plum': 'sp-tree-purpleplum-16ft',
  'red berries 14ft': 'sp-tree-purpleplum-16ft',
  'small tree': 'sp-tree-small-15ft',
  'blue car': 'sedan-rig',
  'blue car rev': 'sedan-rig',
  'blue truck': '',
  'blue truck rev': '',
  'dump truck': '',
  'dump truck rev': '',
  'green car': 'sedan-rig',
  'green car rev': 'sedan-rig',
  'moto highway rider': 'tuk-tukmotorbike',
  'moto highway rider rev': 'tuk-tukmotorbike',
  'orange truck': '',
  'orange truck rev': '',
  'red car': 'sedan-rig',
  'red car rev': 'sedan-rig',
  'red jeep': '',
  'red jeep rev': '',
  'semi truck': '',
  'semi truck rev': '',
  'silver suv': 'suv-rig',
  'silver suv rev': 'suv-rig',
  truck: '',
  'truck fedex': 'box-truck-rig',
  'truck fedex rev': 'box-truck-rig',
  'truck ups': 'box-truck-rig',
  'truck ups rev': 'box-truck-rig',
  'two cars passing': '',
  'white coup': 'sedan-rig',
  'white coup rev': 'sedan-rig',
  'white sedan': 'sedan-rig',
  'white sedan rev': 'sedan-rig',
  'white truck': '',
  'white truck rev': '',
  'yellow sedan': 'sedan-rig',
  'yellow sedan rev': 'sedan-rig',
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
