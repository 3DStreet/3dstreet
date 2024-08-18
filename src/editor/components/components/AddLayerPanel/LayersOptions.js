const LayersOptions = [
  {
    value: 'Street Layers',
    label: 'Street Layers',
    onClick: () => {}
  },
  {
    value: 'Dividers & Traffic Control',
    label: 'Dividers & Traffic Control',
    mixinGroups: ['dividers'],
    onClick: () => {}
  },
  {
    value: 'Motor Vehicles',
    label: 'Motor Vehicles',
    mixinGroups: ['vehicles-rigged', 'vehicles-transit'],
    onClick: () => {}
  },
  {
    value: 'People Power Vehicles',
    label: 'People Power Vehicles',
    mixinGroups: ['vehicles', 'cyclists'],
    onClick: () => {}
  },
  {
    value: 'Pro Layers',
    label: 'Pro Layers',
    onClick: () => {}
  },
  {
    value: 'Characters',
    label: 'Characters',
    mixinGroups: ['people'],
    onClick: () => {}
  },
  {
    value: 'Sidewalk Props',
    label: 'Sidewalk Props',
    mixinGroups: ['sidewalk-props', 'intersection-props'],
    onClick: () => {}
  },

  {
    value: 'Models: Buildings',
    label: 'Models: Buildings',
    mixinGroups: ['buildings'],
    onClick: () => {}
  }
];

export { LayersOptions };
