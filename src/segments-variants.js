const segmentVariants = {
  /* sidewalk segments */
  sidewalk: ['empty', 'sparse', 'normal', 'dense'],
  'sidewalk-wayfinding': ['large'],
  'sidewalk-bench': ['left', 'right', 'center'],
  'sidewalk-bike-rack': [
    'left|sidewalk-parallel',
    'right|sidewalk-parallel',
    'left|sidewalk',
    'right|sidewalk'
  ],
  'sidewalk-tree': ['big', 'palm-tree'],
  /* lights and utilities */
  utilities: ['left', 'right'],
  'sidewalk-lamp': [
    'right|modern',
    'both|modern',
    'left|modern',
    'right|traditional',
    'both|traditional',
    'left|traditional',
    'right|pride',
    'both|pride',
    'left|pride'
  ],
  // furniture segments
  parklet: ['left', 'right'],
  'outdoor-dining': ['empty|sidewalk', 'empty|road'],
  bikeshare: ['left|road', 'right|road', 'left|sidewalk', 'right|sidewalk'],
  // bike and scooter segments
  'bike-lane': [
    'inbound|green|sidewalk',
    'inbound|green|road',
    'outbound|green|sidewalk',
    'outbound|green|road',
    'inbound|regular|sidewalk',
    'inbound|regular|road',
    'outbound|regular|sidewalk',
    'outbound|regular|road',
    'inbound|red|sidewalk',
    'inbound|red|road',
    'outbound|red|sidewalk',
    'outbound|red|road'
  ],
  scooter: [
    'inbound|regular',
    'inbound|green',
    'inbound|red',
    'outbound|regular',
    'outbound|green',
    'outbound|red'
  ],
  // road segments
  'bus-lane': [
    'inbound|colored|typical',
    'outbound|colored|typical',
    'inbound|regular|typical',
    'outbound|regular|typical',
    'inbound|red|typical',
    'outbound|red|typical'
  ],
  'drive-lane': [
    'inbound|car',
    'outbound|car',
    'inbound|truck',
    'outbound|truck',
    'outbound|av',
    'inbound|av',
    'outbound|pedestrian',
    'inbound|pedestrian',
    'inbound|sharrow',
    'outbound|sharrow'
  ],
  'turn-lane': [
    'inbound|left',
    'inbound|right',
    'inbound|left-right-straight',
    'inbound|shared',
    'inbound|both',
    'inbound|left-straight',
    'inbound|right-straight',
    'inbound|straight',
    'outbound|left',
    'outbound|right',
    'outbound|left-right-straight',
    'outbound|shared',
    'outbound|both',
    'outbound|left-straight',
    'outbound|right-straight',
    'outbound|straight'
  ],
  'parking-lane': [
    'sideways|right',
    'sideways|left',
    'inbound|right',
    'inbound|left',
    'outbound|left',
    'outbound|right',
    'angled-front-left|left',
    'angled-front-right|left',
    'angled-rear-left|left',
    'angled-rear-right|left',
    'angled-front-left|right',
    'angled-front-right|right',
    'angled-rear-left|right',
    'angled-rear-right|right'
  ],
  'food-truck': ['left', 'right'],
  'flex-zone': [
    'taxi|inbound|right',
    'taxi|inbound|left',
    'taxi|outbound|right',
    'taxi|outbound|left',
    'rideshare|outbound|right',
    'rideshare|outbound|right',
    'rideshare|inbound|right',
    'rideshare|inbound|left'
  ],
  // rail vehicles
  streetcar: [
    'inbound|regular',
    'inbound|colored',
    'inbound|grass',
    'outbound|regular',
    'outbound|colored',
    'outbound|grass'
  ],
  'light-rail': [
    'inbound|regular',
    'inbound|colored',
    'inbound|grass',
    'outbound|regular',
    'outbound|colored',
    'outbound|grass'
  ],
  // stations
  'brt-station': ['center'],
  'transit-shelter': [
    'left|street-level',
    'right|street-level',
    'right|light-rail',
    'left|light-rail'
  ],
  // divider and temporary
  divider: [
    'buffer',
    'flowers',
    'planting-strip',
    'planter-box',
    'palm-tree',
    'big-tree',
    'bush',
    'dome',
    'bollard',
    'striped-buffer'
  ],
  temporary: [
    'barricade',
    'traffic-cone',
    'jersey-barrier-plastic',
    'jersey-barrier-concrete'
  ],
  // magic segment
  'magic-carpet': ['aladdin']
};

module.exports.segmentVariants = segmentVariants;
