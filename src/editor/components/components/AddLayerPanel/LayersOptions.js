const LayersOptions = [
  {
    value: 'Models: Personal Vehicles',
    label: 'Models: Personal Vehicles',
    mixinGroups: ['vehicles', 'vehicles-rigged'],
    onClick: () => console.log('Models: Personal Vehicles')
  },
  {
    value: 'Pro Layers',
    label: 'Pro Layers',
    onClick: () => console.log('Layers: Streets & Intersections')
  },
  {
    value: 'Models: Transit Vehicles',
    label: 'Models: Transit Vehicles',
    mixinGroups: ['vehicles-transit'],
    onClick: () => console.log('Models: Transit Vehicles')
  },
  {
    value: 'Models: Utility Vehicles',
    label: 'Models: Utility Vehicles',
    mixinGroups: ['vehicles-rigged'],
    onClick: () => console.log('Models: Utility Vehicles')
  },
  {
    value: 'Models: Characters',
    label: 'Models: Characters',
    mixinGroups: ['people', 'people-rigged'],
    onClick: () => console.log('Models: Characters')
  },
  {
    value: 'Models: Street Props',
    label: 'Models: Street Props',
    mixinGroups: ['sidewalk-props', 'intersection-props'],
    onClick: () => console.log('Models: Street Props')
  },
  {
    value: 'Models: Dividers & Traffic Control',
    label: 'Models: Dividers & Traffic Control',
    mixinGroups: ['dividers'],
    onClick: () => console.log('Models: dividers')
  },
  {
    value: 'Models: Buildings',
    label: 'Models: Buildings',
    mixinGroups: ['buildings'],
    onClick: () => console.log('Models: Buildings')
  }
];

export { LayersOptions };
