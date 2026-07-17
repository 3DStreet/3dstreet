const LayersOptions = [
  {
    value: 'Streets and Intersections',
    label: '🚦 Streets',
    onClick: () => {}
  },
  {
    value: 'Traffic Control',
    label: '🚧 Control',
    mixinGroups: ['dividers', 'traffic-control'],
    onClick: () => {}
  },
  {
    value: 'Signs',
    label: '🚸 Signs',
    mixinGroups: ['signs'],
    onClick: () => {}
  },
  {
    value: 'Plants',
    label: '🌿 Plants',
    mixinGroups: ['plants'],
    onClick: () => {}
  },
  {
    value: 'Fixtures',
    label: '🚏 Fixtures',
    mixinGroups: ['fixtures'],
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
    value: 'Shapes',
    label: '🔵 Shapes',
    onClick: () => {}
  },
  {
    value: 'Custom Layers',
    label: '⚙️ Custom',
    onClick: () => {}
  }
];

export { LayersOptions };
