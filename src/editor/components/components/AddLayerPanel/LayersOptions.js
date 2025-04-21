const LayersOptions = [
  {
    value: 'Streets and Intersections',
    label: '🚦 Streets & Intersections',
    onClick: () => {}
  },
  {
    value: 'Traffic Control',
    label: '🚧 Traffic Control',
    mixinGroups: ['dividers'],
    onClick: () => {}
  },
  {
    value: 'Signs',
    label: '🚸 Signs',
    mixinGroups: ['signs'],
    onClick: () => {}
  },
  {
    value: 'Sidewalk Props',
    label: '🌳 Sidewalk Props',
    mixinGroups: ['sidewalk-props', 'intersection-props'],
    onClick: () => {}
  },
  {
    value: 'People',
    label: '🚶 People',
    mixinGroups: ['people'],
    onClick: () => {}
  },
  {
    value: 'Bicycles',
    label: '🚲 Bicycles',
    mixinGroups: ['vehicles', 'cyclists'],
    onClick: () => {}
  },
  {
    value: 'Vehicles',
    label: '🚗 Vehicles',
    mixinGroups: ['vehicles-rigged', 'vehicles-transit'],
    onClick: () => {}
  },
  {
    value: 'Buildings',
    label: '🏠 Buildings',
    mixinGroups: ['buildings'],
    onClick: () => {}
  },
  {
    value: 'Custom Layers',
    label: '⚙️ Custom Layers',
    onClick: () => {}
  }
];

export { LayersOptions };
