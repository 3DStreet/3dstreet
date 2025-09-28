// Define some example streets in Managed Street object format

export const stroad60ftROW = {
  name: '60ft Right of Way 36ft Road Width',
  width: 18.288, // Keep in meters
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
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
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
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
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 0
          }
        ]
      }
    },
    {
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
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
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 180
          }
        ]
      }
    },
    {
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
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
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

export const stroad40ftROW = {
  name: '40ft Right of Way 24ft Road Width',
  width: 12.192, // Original 40ft converted to meters
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
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
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
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
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
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

export const stroad80ftROW = {
  name: '80ft Right of Way 56ft Road Width',
  width: 24.384, // Original 80ft converted to meters
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
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
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 0
          }
        ]
      }
    },
    {
      name: 'Inbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438, // Original 8ft
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      name: 'Inbound Drive Lane 1',
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
      name: 'Inbound Drive Lane 2',
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
      name: 'Outbound Drive Lane 1',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048, // Original 10ft
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
      name: 'Outbound Drive Lane 2',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048, // Original 10ft
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
      name: 'Outbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438, // Original 8ft
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 180
          }
        ]
      }
    },
    {
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
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

export const stroad94ftROW = {
  name: '94ft Right of Way 70ft Road Width',
  width: 28.651, // Original 94ft converted to meters
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
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
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 0
          }
        ]
      }
    },
    {
      name: 'Inbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438, // Original 8ft
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      name: 'Inbound Drive Lane 1',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
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
      name: 'Inbound Drive Lane 2',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
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
      name: 'Center Turn Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048, // Original 10ft
      generated: {
        stencil: [
          {
            modelsArray: 'left',
            cycleOffset: 0.6,
            spacing: 20,
            direction: 'outbound'
          },
          {
            modelsArray: 'left',
            cycleOffset: 0.4,
            spacing: 20,
            direction: 'inbound'
          }
        ],
        striping: [
          {
            striping: 'solid-dashed-yellow'
          },
          {
            striping: 'solid-dashed-yellow-mirror',
            side: 'right'
          }
        ]
      }
    },
    {
      name: 'Outbound Drive Lane 1',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
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
        ],
        striping: [
          {
            striping: 'none'
          }
        ]
      }
    },
    {
      name: 'Outbound Drive Lane 2',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
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
      name: 'Outbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438, // Original 8ft
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 180
          }
        ]
      }
    },
    {
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
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

export const stroad150ftROW = {
  name: '150ft Right of Way 124ft Road Width',
  width: 45.72, // Original 150ft converted to meters
  length: 100,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
      name: 'Dense Sidewalk',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 2.134, // Original 7ft
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
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 0
          }
        ]
      }
    },
    {
      name: 'Inbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438, // Original 8ft
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      name: 'Inbound Left Turn Lane',
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
            modelsArray: 'sedan-rig, suv-rig',
            spacing: 20,
            count: 2
          }
        ],
        stencil: [
          {
            modelsArray: 'turn-lane-left',
            cycleOffset: 1,
            spacing: 20
          }
        ]
      }
    },
    {
      name: 'Inbound Drive Lane 1',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      name: 'Inbound Truck Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'box-truck-rig, trailer-truck-rig',
            spacing: 15,
            count: 2
          }
        ]
      }
    },
    {
      name: 'Inbound Drive Lane 2',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
      direction: 'inbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      name: 'Inbound Right Turn Lane',
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
            modelsArray: 'sedan-rig, suv-rig',
            spacing: 20,
            count: 2
          }
        ],
        stencil: [
          {
            modelsArray: 'turn-lane-right',
            cycleOffset: 1,
            spacing: 20
          }
        ]
      }
    },
    {
      name: 'Planted Median',
      type: 'divider',
      surface: 'planting-strip',
      color: '#338833',
      level: 1,
      width: 0.61, // Original 2ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'flowers1',
            spacing: 3
          }
        ]
      }
    },
    {
      name: 'Outbound Left Turn Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048, // Original 10ft
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, suv-rig',
            spacing: 20,
            count: 2
          }
        ],
        stencil: [
          {
            modelsArray: 'turn-lane-left',
            cycleOffset: 1,
            spacing: 20
          }
        ]
      }
    },
    {
      name: 'Outbound Drive Lane 1',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      name: 'Outbound Truck Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'box-truck-rig, trailer-truck-rig',
            spacing: 15,
            count: 2
          }
        ]
      }
    },
    {
      name: 'Outbound Drive Lane 2',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.353, // Original 11ft
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray:
              'sedan-rig, self-driving-waymo-car, suv-rig, motorbike',
            spacing: 7.3,
            count: 4
          }
        ]
      }
    },
    {
      name: 'Outbound Right Turn Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 3.048, // Original 10ft
      direction: 'outbound',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, suv-rig',
            spacing: 20,
            count: 2
          }
        ],
        stencil: [
          {
            modelsArray: 'turn-lane-right',
            cycleOffset: 1,
            spacing: 20
          }
        ]
      }
    },
    {
      name: 'Outbound Parking',
      type: 'parking-lane',
      surface: 'concrete',
      color: '#dddddd',
      level: 0,
      width: 2.438, // Original 8ft
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
            modelsArray: 'parking-t',
            cycleOffset: 1,
            spacing: 6
          }
        ]
      }
    },
    {
      name: 'Modern Street Lamp',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'lamp-modern',
            spacing: 30,
            facing: 180
          }
        ]
      }
    },
    {
      name: 'Tree Planting Strip',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 0.914, // Original 3ft
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'tree3',
            spacing: 15
          }
        ]
      }
    },
    {
      name: 'Normal Sidewalk',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 2.134, // Original 7ft
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

export const buildingDemo = {
  name: 'Building Placement Demo',
  width: 18,
  length: 150,
  justifyWidth: 'center',
  justifyLength: 'start',
  segments: [
    {
      name: 'Left Buildings',
      type: 'building',
      surface: 'concrete',
      color: '#ffffff',
      level: 0,
      width: 30,
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fit',
            modelsArray:
              'SM3D_Bld_Mixed_4fl, SM3D_Bld_Mixed_Corner_4fl, SM3D_Bld_Mixed_5fl, SM3D_Bld_Mixed_Double_5fl',
            spacing: 0.5,
            positionX: -20,
            facing: 90
          }
        ]
      }
    },
    {
      name: 'Sidewalk Left',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 3,
      direction: 'none'
    },
    {
      name: 'Drive Lane',
      type: 'drive-lane',
      surface: 'asphalt',
      color: '#ffffff',
      level: 0,
      width: 12,
      direction: 'inbound'
    },
    {
      name: 'Sidewalk Right',
      type: 'sidewalk',
      surface: 'sidewalk',
      color: '#ffffff',
      level: 1,
      width: 3,
      direction: 'none'
    },
    {
      name: 'Right Buildings',
      type: 'building',
      surface: 'concrete',
      color: '#ffffff',
      level: 0,
      width: 30,
      direction: 'none',
      generated: {
        clones: [
          {
            mode: 'fit',
            modelsArray:
              'SM3D_Bld_Mixed_4fl, SM3D_Bld_Mixed_Corner_4fl, SM3D_Bld_Mixed_5fl',
            spacing: 0.5,
            positionX: 20,
            facing: -90
          }
        ]
      }
    }
  ]
};
