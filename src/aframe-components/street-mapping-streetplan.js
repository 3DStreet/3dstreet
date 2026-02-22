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
    modelsArray: 'temporary-jersey-barrier-concrete',
    spacing: 2,
    count: 10,
    facing: 0
  },
  'barrier 2-ft': {
    mode: 'fixed',
    modelsArray: 'temporary-jersey-barrier-concrete',
    spacing: 2,
    count: 10,
    facing: 0
  },
  'bollard plastic yellow': {
    mode: 'fixed',
    modelsArray: 'bollard',
    spacing: 5,
    count: 10,
    facing: 0
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
    modelsArray: 'temporary-traffic-cone',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'slopedgrass 40ft': '',
  'soundwall (12ft)': '',
  'soundwall (8ft)': '',
  'soundwall plants (12ft)': '',
  'soundwall plants (8ft)': '',
  'bench old': {
    mode: 'fixed',
    modelsArray:
      'sp-furn-bench1-5x2ft,bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'bench simple': {
    mode: 'fixed',
    modelsArray:
      'sp-furn-bench2-5x2ft,bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'bikerack bollard': {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'blue mailbox': {
    mode: 'random',
    modelsArray: 'usps-mailbox,bikerack,sp-furn-bench2-5x2ft',
    spacing: 20,
    count: 3,
    facing: 0
  },
  'boxwood planter 2ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush',
    spacing: 10,
    count: 10,
    facing: 0
  },
  'boxwood planter 3ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush',
    spacing: 10,
    count: 10,
    facing: 0
  },
  'flower pot 4ft': '',
  garbagecan: {
    mode: 'random',
    modelsArray: 'trash-bin,sp-furn-table-2x7ft,sideview',
    spacing: 10,
    count: 3,
    facing: 0
  },
  'nyc bike rack': {
    mode: 'random',
    modelsArray: 'bikerack,sp-furn-table-2x7ft,sideview',
    spacing: 10,
    count: 3,
    facing: 0
  },
  'planter flowers': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 5,
    count: 10,
    facing: 0
  },
  'random trashcan': {
    mode: 'random',
    modelsArray: 'trash-bin,sp-furn-table-2x7ft,sideview',
    spacing: 10,
    count: 3,
    facing: 0
  },
  shelter: {
    mode: 'random',
    modelsArray:
      'sp-furn-busstop-shelter-12x4ft,trash-bin,sp-furn-foodcart-5dot5x9ft',
    spacing: 10,
    count: 3,
    facing: 0
  },
  'table small 3ft': {
    mode: 'random',
    modelsArray: 'sp-furn-table-2x7ft,trash-bin,usps-mailbox,bikerack',
    spacing: 10,
    count: 4,
    facing: 0
  },
  tallgrass: {
    mode: 'fixed',
    modelsArray: 'dividers-bush',
    spacing: 2,
    count: 10,
    facing: 0
  },
  'tallgrass 40ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush',
    spacing: 2,
    count: 10,
    facing: 0
  },
  trashcan: {
    mode: 'random',
    modelsArray: 'trash-bin',
    spacing: 10,
    count: 3,
    facing: 0
  },
  'bike food cart': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-busstop-shelter-12x4ft,sp-furn-bench2-5x2ft,sp-furn-table-blue-7x7ft',
    spacing: 10,
    count: 4,
    facing: 0
  },
  'boxwood planter 5ft': {
    mode: 'fixed',
    modelsArray: 'dividers-bush',
    spacing: 10,
    count: 20,
    facing: 0
  },
  'fleamarket stuff': {
    mode: 'random',
    modelsArray:
      'sp-furn-farmertent1-10x10ft,sp-furn-foodcart-5dot5x9ft,sp-furn-sp-furn-farmertent2-10x10ft,sp-furn-table-blue-7x7ft',
    spacing: 10,
    count: 4,
    facing: 0
  },
  'hot dog cart': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-busstop-shelter-12x4ft,sp-furn-bench2-5x2ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'large food cart': {
    mode: 'random',
    modelsArray:
      'sp-furn-foodcart-5dot5x9ft,sp-furn-busstop-shelter-12x4ft,sp-furn-bench2-5x2ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'planter with bench': {
    mode: 'fixed',
    modelsArray: 'sp-furn-bench2-5x2ft,bikerack,trash-bin,bikerack',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'shelter roundroof': {
    mode: 'random',
    modelsArray:
      'sp-furn-busstop-roundshelter-12x13ft,trash-bin,sp-furn-foodcart-5dot5x9ft',
    spacing: 10,
    count: 3,
    facing: 0
  },
  sideview: {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'sideview modern': {
    mode: 'fixed',
    modelsArray: 'bikerack,sp-furn-bench2-5x2ft,bikerack,trash-bin',
    spacing: 20,
    count: 4,
    facing: 0
  },
  table: {
    mode: 'fixed',
    modelsArray: 'sp-furn-table-blue-7x7ft,sp-furn-foodcart-5dot5x9ft',
    spacing: 20,
    count: 2,
    facing: 0
  },
  'tent bluewhite': {
    mode: 'random',
    modelsArray:
      'sp-furn-farmertent1-10x10ft,sp-furn-foodcart-5dot5x9ft,sp-furn-farmertent2-10x10ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'tent veggie': {
    mode: 'random',
    modelsArray:
      'sp-furn-farmertent2-10x10ft,sp-furn-foodcart-5dot5x9ft,sp-furn-farmertent1-10x10ft,sp-furn-table-blue-7x7ft',
    spacing: 20,
    count: 4,
    facing: 0
  },
  'brick apartment 1floor': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft',
    spacing: 0
  },
  'brick apartment 2floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-2L-29ft,sp-prop-sf-1L-41ft',
    spacing: 0
  },
  'brick apartment 3floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'brick apartment 4floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'brick apartment 5floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building blue 1floor': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft',
    spacing: 0
  },
  'building blue 2floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-2L-29ft,sp-prop-sf-1L-41ft',
    spacing: 0
  },
  'building blue 3floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'building blue 4floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building blue 5floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building blue 6floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building blue 7floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building yellow 1floor': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft',
    spacing: 0
  },
  'building yellow 2floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-2L-29ft,sp-prop-sf-1L-41ft',
    spacing: 0
  },
  'building yellow 3floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'building yellow 4floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building yellow 5floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building yellow 6floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'building yellow 7floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-78ft-corner',
    spacing: 0
  },
  'buildings falltrees (30ft)': '',
  'buildings pinetrees (30ft)': '',
  'gas station': {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'home depot': {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'house 1floor': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft',
    spacing: 0
  },
  'house 2floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-sf-1L-41ft,sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft',
    spacing: 0
  },
  'house 3floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-2L-62ft,sp-prop-sf-2L-64ft,sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-sf-2L-64ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'house 4floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-78ft-corner,sp-prop-mixeduse-3L-23ft-corner',
    spacing: 0
  },
  'house 5floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-townhouse-3L-23ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-20ft,sp-prop-mixeduse-3L-78ft-corner,sp-prop-mixeduse-3L-23ft-corner',
    spacing: 0
  },
  'house newurbanist': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft',
    spacing: 0
  },
  'house newurbanist red': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft',
    spacing: 0
  },
  'live work': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'mart chilis': {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'mikedesign midvale 2story': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft',
    spacing: 0
  },
  'mikedesign midvale 3story': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft',
    spacing: 0
  },
  'mikedesign midvale3 3story': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft',
    spacing: 0
  },
  'mixed use 2floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-2L-29ft,sp-prop-sf-2L-64ft',
    spacing: 0
  },
  'mixed use 3floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-22ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-23ft',
    spacing: 0
  },
  'mixed use 4floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-22ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-23ft',
    spacing: 0
  },
  'mixed use 5floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-22ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-23ft',
    spacing: 0
  },
  'nice apartment 3story': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-22ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-23ft',
    spacing: 0
  },
  'nice apartment 4story': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-22ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-23ft',
    spacing: 0
  },
  'nice apartment 5story': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-22ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-23ft',
    spacing: 0
  },
  'nice apartment 6story': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-3L-22ft,sp-prop-townhouse-3L-20ft,sp-prop-townhouse-3L-23ft',
    spacing: 0
  },
  'red mixed use 1floor': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'red mixed use 2floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'red mixed use 3floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'red mixed use 4floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  'red mixed use 5floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-2L-30ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft,sp-prop-townhouse-3L-20ft',
    spacing: 0
  },
  residential: {
    mode: 'fit',
    modelsArray: 'SM_Bld_House_Preset_09_1845,SM_Bld_House_Preset_03_1800',
    spacing: 0
  },
  'river crosssection': '',
  'river crosssection 20ft': '',
  'river crosssection 40ft': '',
  'shop 1floor': {
    mode: 'fit',
    modelsArray: 'sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft',
    spacing: 0
  },
  'shop 2floors': {
    mode: 'fit',
    modelsArray: 'sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft',
    spacing: 0
  },
  'shop 3floors': {
    mode: 'fit',
    modelsArray:
      'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-3L-23ft-corner,sp-prop-mixeduse-2L-29ft,sp-prop-mixeduse-2L-30ft',
    spacing: 0
  },
  'shop 4floors': '',
  'single family': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft',
    spacing: 0
  },
  'single family back': {
    mode: 'fit',
    modelsArray:
      'sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft,sp-prop-sf-1L-41ft,sp-prop-sf-1L-62ft,sp-prop-sf-2L-62ft',
    spacing: 0
  },
  'stripmall onerowparking': {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'stripmall1 tworowsparking': {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'stripmall1, onerowparking': {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'stripmall2 tworowsparking': {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'townhouse row 3story': {
    mode: 'fit',
    modelsArray: 'sp-prop-mixeduse-3L-22ft,sp-prop-mixeduse-3L-23ft-corner',
    spacing: 0
  },
  walmart: {
    mode: 'fit',
    modelsArray: 'sp-prop-bigbox-1L-220ft,sp-prop-bigbox-1L-291ft',
    spacing: 0
  },
  'water 20ft': '',
  'water 30ft': '',
  'blank pedrefuge (8ft)': '',
  'cactus median (10ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'cactus median (12ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'cactus median (4ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'cactus median (6ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'cactus median (8ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'flower median (10ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'flower median (12ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'flower median (4ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'flower median (6ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'flower median (8ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'flowers pedrefuge (8ft)': {
    mode: 'fixed',
    modelsArray: 'dividers-flowers',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'grassslopemedian (12ft)': '',
  'grassslopemedian (24ft)': '',
  'grassy median (10ft)': '',
  'grassy median (12ft)': '',
  'grassy median (4ft)': '',
  'grassy median (6ft)': '',
  'grassy median (8ft)': '',
  'rock median (10ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'rock median (12ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'rock median (4ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'rock median (6ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'rock median (8ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox (10ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox (12ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox (4ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox (6ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox (8ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox pedref (10ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox pedref (12ft)': {
    mode: 'fixed',
    modelsArray: 'ssp-median-planterbox-tall-10x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox pedref (6ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tallplantbox pedref (8ft)': {
    mode: 'fixed',
    modelsArray: 'sp-median-planterbox-tall-06x30ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'tropical median (4ft)': {
    mode: 'fixed',
    modelsArray: 'dividers-flowers',
    spacing: 15,
    count: 20,
    facing: 0
  },
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
    modelsArray: 'sp-parking-planter-5x8ft',
    spacing: 7,
    count: 10,
    facing: 0
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
    modelsArray: 'bicycle_1',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'bike rider rev': {
    mode: 'fixed',
    modelsArray: 'bicycle_1',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'bikelane sharecar': '',
  'bikelane sharecar rev': '',
  'casual woman': {
    mode: 'fixed',
    modelsArray: 'bicycle_1',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'casual woman 2': {
    mode: 'fixed',
    modelsArray: 'cyclist3',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'casual woman 2 rev': {
    mode: 'fixed',
    modelsArray: 'cyclist-dutch',
    spacing: 50,
    count: 10,
    facing: 0
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
    modelsArray: 'cyclist-kid',
    spacing: 50,
    count: 10,
    facing: 0
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
    modelsArray: 'cyclist-cargo',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'serious man': {
    mode: 'fixed',
    modelsArray: 'cyclist2',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'serious man rev': {
    mode: 'fixed',
    modelsArray: 'cyclist2',
    spacing: 50,
    count: 10,
    facing: 0
  },
  smallnev: '',
  smallscooter: {
    mode: 'fixed',
    modelsArray: 'electricscooter_1',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'two bikes back': '',
  'two bikes come and go': '',
  'widebikepath twosides': '',
  'woman bike': {
    mode: 'fixed',
    modelsArray: 'cyclist-dutch',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'woman jogging': {
    mode: 'random',
    modelsArray: 'char1,char2,char3,char4,char5,char6',
    spacing: 15,
    count: 20,
    facing: 0
  },
  '2 people': {
    mode: 'random',
    modelsArray: 'char2,char7,char8,char9,char10,char11',
    spacing: 15,
    count: 20,
    facing: 0
  },
  '3 people': {
    mode: 'random',
    modelsArray: 'char3,char12,char13,char14,char15,char16',
    spacing: 15,
    count: 20,
    facing: 0
  },
  couple: {
    mode: 'random',
    modelsArray: 'char4,char3,char13,char2,char15,char3',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'dog walker': {
    mode: 'random',
    modelsArray: 'char5,char8,char8,char7,char10,char8',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'grandpa and todler': {
    mode: 'random',
    modelsArray: 'char6,char13,char3,char12,char5,char13',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'lady crossing street': {
    mode: 'random',
    modelsArray: 'char7,char2,char3,char4,char5,char6',
    spacing: 15,
    count: 20,
    facing: 0
  },
  man: {
    mode: 'random',
    modelsArray: 'char8,char7,char8,char9,char10,char11',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'man and girl': {
    mode: 'random',
    modelsArray: 'char1,char12,char13,char14,char15,char16',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'man come': {
    mode: 'random',
    modelsArray: 'char2,char3,char13,char2,char15,char3',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'man come rev': {
    mode: 'random',
    modelsArray: 'char3,char8,char8,char7,char10,char8',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'man go': {
    mode: 'random',
    modelsArray: 'char4,char13,char3,char12,char5,char13',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'man go rev': {
    mode: 'random',
    modelsArray: 'char5,char2,char3,char4,char5,char6',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'man jogging': {
    mode: 'random',
    modelsArray: 'char6,char7,char8,char9,char10,char11',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'man walking': {
    mode: 'random',
    modelsArray: 'char7,char12,char13,char14,char15,char16',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'older couple': {
    mode: 'random',
    modelsArray: 'char8,char3,char13,char2,char15,char3',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'older ladies walking': {
    mode: 'random',
    modelsArray: 'char9,char8,char8,char7,char10,char8',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'older man walking': {
    mode: 'random',
    modelsArray: 'char10,char13,char3,char12,char5,char13',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'small girl': {
    mode: 'random',
    modelsArray: 'char11,char2,char3,char4,char5,char6',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'wheel chair': {
    mode: 'random',
    modelsArray: 'char12,char7,char8,char9,char10,char11',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'woman back': {
    mode: 'random',
    modelsArray: 'char13,char12,char13,char14,char15,char16',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'woman in hat': {
    mode: 'random',
    modelsArray: 'char14,char3,char13,char2,char15,char3',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'woman shopping': {
    mode: 'random',
    modelsArray: 'char15,char8,char8,char7,char10,char8',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'woman walking': {
    mode: 'random',
    modelsArray: 'char16,char13,char3,char12,char5,char13',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'young woman walking': {
    mode: 'random',
    modelsArray: 'char8,char2,char3,char4,char5,char6',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'cobra light': {
    mode: 'fixed',
    modelsArray: 'lamp-modern',
    spacing: 70,
    count: 20,
    facing: 0
  },
  'hawk signal narrow': {
    mode: 'single',
    modelsArray: 'signal_right',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'hawk signal wide': {
    mode: 'single',
    modelsArray: 'signal_right',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'hawk signal xwide': {
    mode: 'single',
    modelsArray: 'signal_right',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'historic light': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'historic no banner': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'historic with banners': {
    mode: 'fixed',
    modelsArray: 'sp-light-flowerp-bannerby-13ft',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'historic with flowers 1': {
    mode: 'fixed',
    modelsArray: 'sp-light-flowerp-bannerby-13ft',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'historic with flowers 2': {
    mode: 'fixed',
    modelsArray: 'sp-light-flowery-bannerrg-13ft',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'light rail poles': '',
  'power tower 30ft': '',
  'street light': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'streetlight solar': {
    mode: 'fixed',
    modelsArray: 'lamp-traditional',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'streetlight solar banners 1': {
    mode: 'fixed',
    modelsArray: 'sp-light-flowerp-bannerby-13ft',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'streetlight solar banners 2': {
    mode: 'fixed',
    modelsArray: 'sp-light-flowery-bannerrg-13ft',
    spacing: 30,
    count: 10,
    facing: 0
  },
  'telephone pole': {
    mode: 'fixed',
    modelsArray: 'utility_pole',
    spacing: 50,
    count: 10,
    facing: 0
  },
  'billboard sign': '',
  brickpillar: '',
  'countrymile sign': '',
  'motel sign': '',
  'shop united sign': '',
  'sign directory': {
    mode: 'fixed',
    modelsArray: 'wayfinding-box',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'stroad sign landr 16ft': '',
  'used cars sign': '',
  usedcars: '',
  'vivo sign': '',
  '10 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-10mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '10 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-10mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '12 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-12mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '12 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-12mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '15 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-15mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '15 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-15mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '20 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-20mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '20 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-20mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '25 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-25mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '25 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-25mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '30 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-30mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '30 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-30mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '35 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-35mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '35 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-35mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '40 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-40mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '40 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-40mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '45 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-45mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '45 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-45mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '50 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-50mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '50 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-50mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '55 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-55mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '55 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-55mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '60 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-60mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '60 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-60mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '65 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-65mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '65 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-65mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '70 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-70mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '70 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-70mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '75 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-75mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '75 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-75mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '80 mph': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-80mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  '80 mph nopole': {
    mode: 'fixed',
    modelsArray: 'sp-sign-speed-limit-80mph',
    spacing: 100,
    count: 10,
    facing: 0
  },
  boulevardcirculator: {
    mode: 'fixed',
    modelsArray: 'minibus',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'boulevardcirculator rev': {
    mode: 'fixed',
    modelsArray: 'minibus',
    spacing: 100,
    count: 10,
    facing: 0
  },
  bus: {
    mode: 'fixed',
    modelsArray: 'bus',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'bus rev': {
    mode: 'fixed',
    modelsArray: 'bus',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'heavy rail': '',
  'heavy rail rev': '',
  'streetcar blue': {
    mode: 'fixed',
    modelsArray: 'trolley',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'streetcar blue rev': {
    mode: 'fixed',
    modelsArray: 'trolley',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'streetcar red 1': {
    mode: 'fixed',
    modelsArray: 'trolley',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'streetcar red 1 rev': {
    mode: 'fixed',
    modelsArray: 'trolley',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'streetcar red 2': {
    mode: 'fixed',
    modelsArray: 'trolley',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'streetcar red 2 rev': {
    mode: 'fixed',
    modelsArray: 'trolley',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'streetcar yellow': {
    mode: 'fixed',
    modelsArray: 'trolley',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'uta bus': {
    mode: 'fixed',
    modelsArray: 'bus',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'uta lightrail': {
    mode: 'fixed',
    modelsArray: 'tram',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'uta lightrail rev': {
    mode: 'fixed',
    modelsArray: 'tram',
    spacing: 100,
    count: 10,
    facing: 0
  },
  'bur oak': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-24ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'desertwillow texas': {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'english oak': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'floweringpear 18ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  goldenraintree: {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  honeylocust: {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'japanese lilac': {
    mode: 'fixed',
    modelsArray: 'sp-tree-japaneselilac-20ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'japanese zelkova': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'jerusalem thorn': {
    mode: 'fixed',
    modelsArray: 'sp-tree-honeylocust-24ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'kentucky coffeetree': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'large oak': {
    mode: 'fixed',
    modelsArray: 'sp-tree-buroak-28ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'palm tree': {
    mode: 'fixed',
    modelsArray: 'sp-tree-palm-26ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'palmtree 20ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-palm-26ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'palmtree 28ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-palm-28ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'pine tree': '',
  'pink flower 16ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'purpleleaf plum': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'red berries 14ft': {
    mode: 'fixed',
    modelsArray: 'sp-tree-purpleplum-16ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'small tree': {
    mode: 'fixed',
    modelsArray: 'sp-tree-small-15ft',
    spacing: 15,
    count: 10,
    facing: 0
  },
  'blue car': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'blue car rev': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'blue truck': {
    mode: 'random',
    modelsArray: 'vehicle-bmw-m2, suv-rig, sedan-rig',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'blue truck rev': {
    mode: 'random',
    modelsArray: 'vehicle-bmw-m2, suv-rig, sedan-rig',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'dump truck': {
    mode: 'random',
    modelsArray: 'box-truck-rig, trailer-truck-rig',
    spacing: 25,
    count: 20,
    facing: 0
  },
  'dump truck rev': {
    mode: 'random',
    modelsArray: 'box-truck-rig, trailer-truck-rig',
    spacing: 25,
    count: 20,
    facing: 0
  },
  'green car': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'green car rev': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'moto highway rider': {
    mode: 'random',
    modelsArray: 'motorbike, tuk-tuk',
    spacing: 20,
    count: 20,
    facing: 0
  },
  'moto highway rider rev': {
    mode: 'random',
    modelsArray: 'motorbike, tuk-tuk',
    spacing: 20,
    count: 20,
    facing: 0
  },
  'orange truck': {
    mode: 'random',
    modelsArray: 'suv-rig, sedan-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'orange truck rev': {
    mode: 'random',
    modelsArray: 'suv-rig, sedan-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'red car': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'red car rev': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'red jeep': {
    mode: 'random',
    modelsArray: 'suv-rig, sedan-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'red jeep rev': {
    mode: 'random',
    modelsArray: 'suv-rig, sedan-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'semi truck': {
    mode: 'random',
    modelsArray: 'trailer-truck-rig, box-truck-rig',
    spacing: 30,
    count: 20,
    facing: 0
  },
  'semi truck rev': {
    mode: 'random',
    modelsArray: 'trailer-truck-rig, box-truck-rig',
    spacing: 30,
    count: 20,
    facing: 0
  },
  'silver suv': {
    mode: 'random',
    modelsArray: 'suv-rig, sedan-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'silver suv rev': {
    mode: 'random',
    modelsArray: 'suv-rig, sedan-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  truck: {
    mode: 'random',
    modelsArray: 'box-truck-rig, trailer-truck-rig',
    spacing: 25,
    count: 20,
    facing: 0
  },
  'truck fedex': {
    mode: 'random',
    modelsArray: 'box-truck-rig',
    spacing: 25,
    count: 20,
    facing: 0
  },
  'truck fedex rev': {
    mode: 'random',
    modelsArray: 'box-truck-rig',
    spacing: 25,
    count: 20,
    facing: 0
  },
  'truck ups': {
    mode: 'random',
    modelsArray: 'box-truck-rig',
    spacing: 25,
    count: 20,
    facing: 0
  },
  'truck ups rev': {
    mode: 'random',
    modelsArray: 'box-truck-rig',
    spacing: 25,
    count: 20,
    facing: 0
  },
  'two cars passing': '',
  'white coup': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'white coup rev': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'white sedan': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'white sedan rev': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'white truck': '',
  'white truck rev': '',
  'yellow sedan': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'yellow sedan rev': {
    mode: 'random',
    modelsArray: 'sedan-rig, suv-rig, self-driving-waymo-car',
    spacing: 15,
    count: 20,
    facing: 0
  },
  'empty path': '',
  'empty place holder': '',
  narrow: '',
  'no sign': '',
  wide: '',
  'csv-eof': ''
};

export {
  STREETPLAN_MATERIAL_MAPPING,
  STREETPLAN_OBJECT_TO_GENERATED_CLONES_MAPPING
};
