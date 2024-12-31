// Define some example streets in Managed Street object format

export const stroad60ftROW = {
  id: '2d729802-6d80-45fa-89bd-f6d6b120d936',
  name: '60ft Right of Way 36ft Road Width',
  width: 18.288, // Keep in meters
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
      id: 'JCWzsLQHmyfDHzQhi9_pU',
      name: 'Dense Sidewalk',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 1.829,
      direction: 'none',
      generated: {
        pedestrians: [
          {
            density: 'dense'
          }
        ]
      }
    },
    {
      id: 'RsLZFtSi3oJH7uufQ5rc4',
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914,
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            model: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      id: 'Xf2CNmHkMaGkTM8EaJn6h',
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914,
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            model: 'lamp-modern',
            spacing: 30,
            facing: 0
          }
        ]
      }
    },
    {
      id: 'GbEHhCMPmVom_IJK-xIn3',
      name: 'Inbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438,
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, self-driving-waymo-car, suv-rig',
            spacing: 6,
            count: 6
          }
        ],
        stencil: [
          {
            model: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      id: 'z4gZgzYoM7sQ7mzIV01PC',
      name: 'Inbound Drive Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048,
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      id: 'myp8_d3x_-hwuhTyH8ux1',
      name: 'Outbound Drive Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048,
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      id: 'ARosTXeWGXp17QyfZgSKB',
      name: 'Outbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438,
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, self-driving-waymo-car, suv-rig',
            spacing: 6,
            count: 6
          }
        ],
        stencil: [
          {
            model: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      id: 'oweuZgwBHUbt65Ep7GZhU',
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914,
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            model: 'lamp-modern',
            spacing: 30,
            facing: 180
          }
        ]
      }
    },
    {
      id: 'vL9qDNp5neZt32zlZ9ExG',
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914,
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            model: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      id: 'RClRRZoof9_BYnqQm7mz-',
      name: 'Normal Sidewalk',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 1.829,
      direction: 'none',
      generated: {
        pedestrians: [
          {
            density: 'normal'
          }
        ]
      }
    }
  ]
};

export const exampleStreet = {
  id: 'aaaaaaaa-0123-4678-9000-000000000000',
  name: "Kieran's Basic Street",
  width: 40,
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
      id: 'aaaaaaaa-0123-4678-9000-000000000001',
      name: 'Sidewalk for walking',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 3,
      direction: 'none',
      generated: {
        pedestrians: [
          {
            density: 'normal'
          }
        ]
      }
    },
    {
      id: 'aaaaaaaa-0123-4678-9000-000000000002',
      name: 'Sidewalk for trees and stuff',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 1,
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            model: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      id: 'aaaaaaaa-0123-4678-9000-000000000003',
      name: 'Parking for cars',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 3,
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, self-driving-waymo-car, suv-rig',
            spacing: 6,
            count: 6
          }
        ],
        stencil: [
          {
            model: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      id: 'aaaaaaaa-0123-4678-9000-000000000004',
      name: 'Drive Lane for cars and stuff',
      type: 'drive-lane',
      color: '#ffffff',
      surface: 'asphalt',
      level: 0,
      width: 3,
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      id: 'aaaaaaaa-0123-4678-9000-000000000005',
      name: 'A beautiful median',
      type: 'divider',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.5
    }
  ]
};

export const stroad40ftROW = {
  id: '727dbbf4-692a-48ee-8f99-a056fd60fedd',
  name: '40ft Right of Way 24ft Road Width',
  width: 12.192, // Original 40ft converted to meters
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
      id: 'JCWzsLQHmyfDHzQhi9_pU',
      name: 'Dense Sidewalk',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 1.829, // Original 6ft
      direction: 'none',
      generated: {
        pedestrians: [
          {
            density: 'dense'
          }
        ]
      }
    },
    {
      id: 'RsLZFtSi3oJH7uufQ5rc4',
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.61, // Original 2ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            model: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      id: 'GbEHhCMPmVom_IJK-xIn3',
      name: 'Inbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.134, // Original 7ft
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, self-driving-waymo-car, suv-rig',
            spacing: 6,
            count: 6
          }
        ],
        stencil: [
          {
            model: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      id: 'z4gZgzYoM7sQ7mzIV01PC',
      name: 'Drive Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048, // Original 10ft
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      id: 'ARosTXeWGXp17QyfZgSKB',
      name: 'Outbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.134, // Original 7ft
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, self-driving-waymo-car, suv-rig',
            spacing: 6,
            count: 6
          }
        ],
        stencil: [
          {
            model: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      id: 'vL9qDNp5neZt32zlZ9ExG',
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.61, // Original 2ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            model: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      id: 'RClRRZoof9_BYnqQm7mz-',
      name: 'Normal Sidewalk',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 1.829, // Original 6ft
      direction: 'none',
      generated: {
        pedestrians: [
          {
            density: 'normal'
          }
        ]
      }
    }
  ]
};
