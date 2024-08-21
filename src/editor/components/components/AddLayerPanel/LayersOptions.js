const LayersOptions = [
  {
    value: 'Dividers & Traffic Control',
    label: '🚧 Dividers & Traffic Control',
    mixinGroups: ['dividers'],
    onClick: () => {}
  },
  {
    value: 'Street Layers',
    label: '🛣️ Street Layers',
    onClick: () => {}
  },
  {
    value: 'Pro Layers',
    label: '🌏 Pro Layers',
    onClick: () => {}
  },
  {
    value: 'Motor Vehicles',
    label: '🚗 Motor Vehicles',
    mixinGroups: ['vehicles-rigged', 'vehicles-transit'],
    onClick: () => {}
  },
  {
    value: 'People Power Vehicles',
    label: '🚲 People Power Vehicles',
    mixinGroups: ['vehicles', 'cyclists'],
    onClick: () => {}
  },
  {
    value: 'Characters',
    label: '🚶 Characters',
    mixinGroups: ['people'],
    onClick: () => {}
  },
  {
    value: 'Sidewalk Props',
    label: '🌳 Sidewalk Props',
    mixinGroups: ['sidewalk-props', 'intersection-props'],
    onClick: () => {}
  },

  {
    value: 'Buildings',
    label: '🏠 Buildings',
    mixinGroups: ['buildings'],
    onClick: () => {}
  }
];

export { LayersOptions };
