/**
 * Generates the .streetmix.json fixture files used by compare-imports.mjs.
 *
 * Each fixture mimics a Streetmix API response (the shape both importers
 * consume: `{ name, data: { street: { schemaVersion, segments, ... } } }`),
 * authored at schemaVersion 33: widths in meters, elevation in meters
 * (multiples of the 0.15m curb height).
 *
 * The street specs below are themed to be semi-plausible streetscapes while
 * together covering EVERY segment type + variant that 3DStreet supports
 * (per src/segments-variants.js). Generation fails if any variant is missed,
 * so extending segments-variants.js forces a fixture update.
 *
 * Usage: node test/parity/generate-fixtures.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { segmentVariants } = require('../../src/segments-variants.js');

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SCHEMA_VERSION = 33;
const CURB_HEIGHT = 0.15; // meters per elevation level (street-segment-utils)

// Typical widths in meters per segment type (overridable per segment)
const DEFAULT_WIDTHS = {
  sidewalk: 2.4,
  'sidewalk-wayfinding': 1.2,
  'sidewalk-bench': 1.2,
  'sidewalk-bike-rack': 1.5,
  'sidewalk-tree': 1.2,
  utilities: 1.2,
  'sidewalk-lamp': 1.2,
  parklet: 2.4,
  'outdoor-dining': 2.4,
  bikeshare: 2.4,
  'bike-lane': 1.8,
  scooter: 1.8,
  'bus-lane': 3.6,
  'brt-lane': 3.6,
  'drive-lane': 3,
  'turn-lane': 3,
  'parking-lane': 2.4,
  'food-truck': 3,
  'flex-zone': 3,
  streetcar: 3.6,
  'light-rail': 3.6,
  'brt-station': 2.4,
  'transit-shelter': 2.4,
  divider: 0.9,
  temporary: 1.2,
  'magic-carpet': 2.4
};

// Elevation level (0 = road, 1 = curb height) by type/variant
function levelFor(type, variantString) {
  if (type.startsWith('sidewalk') || type === 'utilities') return 1;
  if (type === 'transit-shelter' || type === 'brt-station') return 1;
  if (['bikeshare', 'outdoor-dining', 'bike-lane'].includes(type)) {
    return variantString.split('|').includes('sidewalk') ? 1 : 0;
  }
  if (type === 'divider') {
    return ['buffer', 'striped-buffer'].includes(variantString) ? 0 : 1;
  }
  return 0;
}

// Each street: { slug, name, buildings: [left, right], segments: [[type, variantString, width?]] }
const STREETS = [
  {
    slug: 'residential-calm-street',
    name: 'Residential calm street',
    buildings: ['residential', 'residential'],
    segments: [
      ['sidewalk', 'empty'],
      ['sidewalk-tree', 'big'],
      ['sidewalk-lamp', 'left|traditional'],
      ['sidewalk', 'sparse'],
      ['parking-lane', 'inbound|left'],
      ['drive-lane', 'inbound|car'],
      ['drive-lane', 'outbound|car'],
      ['parking-lane', 'outbound|right'],
      ['sidewalk-lamp', 'right|traditional'],
      ['sidewalk-bench', 'right'],
      ['sidewalk', 'normal']
    ]
  },
  {
    slug: 'downtown-main-street',
    name: 'Downtown main street',
    buildings: ['narrow', 'wide'],
    segments: [
      ['sidewalk', 'dense'],
      ['sidewalk-wayfinding', 'large'],
      ['sidewalk-bench', 'left'],
      ['sidewalk-bike-rack', 'left|sidewalk-parallel'],
      ['sidewalk-lamp', 'both|modern'],
      ['outdoor-dining', 'empty|sidewalk'],
      ['flex-zone', 'taxi|inbound|right'],
      ['drive-lane', 'inbound|car'],
      ['turn-lane', 'inbound|shared'],
      ['drive-lane', 'outbound|car'],
      ['flex-zone', 'rideshare|outbound|right'],
      ['parklet', 'right'],
      ['sidewalk-bench', 'center'],
      ['sidewalk', 'dense']
    ]
  },
  {
    slug: 'bikeway-demonstration-street',
    name: 'Bikeway demonstration street',
    buildings: ['grass', 'grass'],
    // adjacent bike lanes deliberately run opposite directions (two-way
    // cycle tracks) to exercise the yellow center-line striping rule
    segments: [
      ['sidewalk', 'normal'],
      ['bike-lane', 'inbound|green|sidewalk'],
      ['bike-lane', 'outbound|green|sidewalk'],
      ['divider', 'planter-box'],
      ['bike-lane', 'inbound|regular|road'],
      ['bike-lane', 'outbound|regular|road'],
      ['divider', 'striped-buffer'],
      ['bike-lane', 'inbound|green|road'],
      ['bike-lane', 'outbound|green|road'],
      ['divider', 'planting-strip'],
      ['bike-lane', 'inbound|regular|sidewalk'],
      ['bike-lane', 'outbound|regular|sidewalk'],
      ['sidewalk', 'normal']
    ]
  },
  {
    slug: 'red-bike-couplet',
    name: 'Red bike lane couplet',
    buildings: ['residential', 'narrow'],
    segments: [
      ['sidewalk', 'sparse'],
      ['bike-lane', 'inbound|red|sidewalk'],
      ['bike-lane', 'inbound|red|road'],
      ['drive-lane', 'inbound|av'],
      ['drive-lane', 'outbound|av'],
      ['bike-lane', 'outbound|red|road'],
      ['bike-lane', 'outbound|red|sidewalk'],
      ['sidewalk', 'sparse']
    ]
  },
  {
    slug: 'scooter-mobility-hub',
    name: 'Scooter mobility hub',
    buildings: ['wide', 'narrow'],
    segments: [
      ['sidewalk', 'normal'],
      ['bikeshare', 'left|sidewalk'],
      ['bikeshare', 'left|road'],
      ['scooter', 'inbound|regular'],
      ['scooter', 'inbound|green'],
      ['scooter', 'inbound|red'],
      ['divider', 'flowers'],
      ['scooter', 'outbound|red'],
      ['scooter', 'outbound|green'],
      ['scooter', 'outbound|regular'],
      ['bikeshare', 'right|road'],
      ['bikeshare', 'right|sidewalk'],
      ['sidewalk', 'normal']
    ]
  },
  {
    slug: 'bus-transit-corridor',
    name: 'Bus transit corridor',
    buildings: ['wide', 'wide'],
    segments: [
      ['sidewalk', 'dense'],
      ['utilities', 'left'],
      ['transit-shelter', 'left|street-level'],
      ['bus-lane', 'inbound|colored|typical'],
      ['bus-lane', 'inbound|regular|typical'],
      ['bus-lane', 'inbound|red|typical'],
      ['divider', 'buffer'],
      ['bus-lane', 'outbound|red|typical'],
      ['bus-lane', 'outbound|regular|typical'],
      ['bus-lane', 'outbound|colored|typical'],
      ['transit-shelter', 'right|street-level'],
      ['utilities', 'right'],
      ['sidewalk', 'dense']
    ]
  },
  {
    slug: 'brt-transitway',
    name: 'BRT transitway',
    buildings: ['wide', 'wide'],
    segments: [
      ['sidewalk', 'normal'],
      ['brt-station', 'left'],
      ['brt-lane', 'inbound|colored'],
      ['brt-lane', 'inbound|regular'],
      ['brt-lane', 'inbound|red'],
      ['brt-station', 'center'],
      ['brt-lane', 'outbound|red'],
      ['brt-lane', 'outbound|regular'],
      ['brt-lane', 'outbound|colored'],
      ['brt-station', 'right'],
      ['sidewalk', 'normal']
    ]
  },
  {
    slug: 'light-rail-avenue',
    name: 'Light rail avenue',
    buildings: ['wide', 'narrow'],
    segments: [
      ['sidewalk', 'dense'],
      ['transit-shelter', 'left|light-rail'],
      ['light-rail', 'inbound|regular'],
      ['light-rail', 'inbound|colored'],
      ['light-rail', 'inbound|grass'],
      ['divider', 'bush'],
      ['light-rail', 'outbound|grass'],
      ['light-rail', 'outbound|colored'],
      ['light-rail', 'outbound|regular'],
      ['transit-shelter', 'right|light-rail'],
      ['sidewalk', 'dense']
    ]
  },
  {
    slug: 'streetcar-heritage-line',
    name: 'Streetcar heritage line',
    buildings: ['narrow', 'narrow'],
    segments: [
      ['sidewalk', 'normal'],
      ['streetcar', 'inbound|regular'],
      ['streetcar', 'inbound|colored'],
      ['streetcar', 'inbound|grass'],
      ['divider', 'dome'],
      ['streetcar', 'outbound|grass'],
      ['streetcar', 'outbound|colored'],
      ['streetcar', 'outbound|regular'],
      ['sidewalk', 'normal']
    ]
  },
  {
    slug: 'arterial-inbound-approach',
    name: 'Arterial inbound approach',
    buildings: ['parking-lot', 'parking-lot'],
    segments: [
      ['sidewalk', 'sparse'],
      ['drive-lane', 'inbound|truck'],
      ['turn-lane', 'inbound|left'],
      ['turn-lane', 'inbound|left-straight'],
      ['turn-lane', 'inbound|straight'],
      ['turn-lane', 'inbound|right-straight'],
      ['turn-lane', 'inbound|right'],
      ['turn-lane', 'inbound|left-right-straight'],
      ['turn-lane', 'inbound|both'],
      ['sidewalk', 'sparse']
    ]
  },
  {
    slug: 'arterial-outbound-approach',
    name: 'Arterial outbound approach',
    buildings: ['parking-lot', 'parking-lot'],
    segments: [
      ['sidewalk', 'sparse'],
      ['turn-lane', 'outbound|both'],
      ['turn-lane', 'outbound|left-right-straight'],
      ['turn-lane', 'outbound|left'],
      ['turn-lane', 'outbound|left-straight'],
      ['turn-lane', 'outbound|straight'],
      ['turn-lane', 'outbound|right-straight'],
      ['turn-lane', 'outbound|right'],
      ['turn-lane', 'outbound|shared'],
      ['drive-lane', 'outbound|truck'],
      ['sidewalk', 'sparse']
    ]
  },
  {
    slug: 'marina-parking-street',
    name: 'Marina parking street',
    buildings: ['waterfront', 'parking-lot'],
    segments: [
      ['sidewalk', 'normal'],
      ['parking-lane', 'sideways|left'],
      ['parking-lane', 'angled-front-left|left'],
      ['parking-lane', 'angled-front-right|left'],
      ['parking-lane', 'angled-rear-left|left'],
      ['parking-lane', 'angled-rear-right|left'],
      ['parking-lane', 'outbound|left'],
      ['drive-lane', 'inbound|car'],
      ['drive-lane', 'outbound|car'],
      ['parking-lane', 'inbound|right'],
      ['parking-lane', 'angled-front-left|right'],
      ['parking-lane', 'angled-front-right|right'],
      ['parking-lane', 'angled-rear-left|right'],
      ['parking-lane', 'angled-rear-right|right'],
      ['parking-lane', 'sideways|right'],
      ['sidewalk', 'normal']
    ]
  },
  {
    slug: 'festival-street',
    name: 'Festival street (closed to traffic)',
    buildings: ['narrow', 'narrow'],
    segments: [
      ['sidewalk', 'dense'],
      ['food-truck', 'left'],
      ['outdoor-dining', 'empty|road'],
      ['temporary', 'jersey-barrier-concrete'],
      ['drive-lane', 'inbound|pedestrian'],
      ['magic-carpet', 'aladdin'],
      ['drive-lane', 'outbound|pedestrian'],
      ['temporary', 'jersey-barrier-plastic'],
      ['temporary', 'traffic-cone'],
      ['temporary', 'barricade'],
      ['food-truck', 'right'],
      ['sidewalk', 'dense']
    ]
  },
  {
    slug: 'landscaped-median-boulevard',
    name: 'Landscaped median boulevard',
    buildings: ['residential', 'grass'],
    segments: [
      ['sidewalk', 'sparse'],
      ['drive-lane', 'inbound|sharrow'],
      ['divider', 'palm-tree'],
      ['divider', 'big-tree'],
      ['divider', 'bollard'],
      ['drive-lane', 'outbound|sharrow'],
      ['sidewalk', 'sparse']
    ]
  },
  {
    slug: 'pedestrian-promenade',
    name: 'Pedestrian promenade',
    buildings: ['wide', 'waterfront'],
    segments: [
      ['sidewalk', 'normal'],
      ['sidewalk-lamp', 'left|modern'],
      ['sidewalk-bike-rack', 'left|sidewalk'],
      ['sidewalk-tree', 'palm-tree'],
      ['sidewalk-lamp', 'both|traditional'],
      ['sidewalk', 'dense'],
      ['sidewalk-lamp', 'both|pride'],
      ['sidewalk-tree', 'big'],
      ['sidewalk-lamp', 'left|pride'],
      ['sidewalk-bike-rack', 'right|sidewalk'],
      ['sidewalk-lamp', 'right|pride'],
      ['sidewalk-bike-rack', 'right|sidewalk-parallel'],
      ['sidewalk-lamp', 'right|modern'],
      ['sidewalk', 'normal']
    ]
  },
  {
    slug: 'curbside-flex-street',
    name: 'Curbside flex zone street',
    buildings: ['narrow', 'wide'],
    segments: [
      ['sidewalk', 'dense'],
      ['parklet', 'left'],
      ['flex-zone', 'taxi|inbound|left'],
      ['flex-zone', 'rideshare|inbound|right'],
      ['flex-zone', 'rideshare|inbound|left'],
      ['drive-lane', 'inbound|car'],
      ['drive-lane', 'outbound|car'],
      ['flex-zone', 'taxi|outbound|right'],
      ['flex-zone', 'taxi|outbound|left'],
      ['sidewalk', 'dense']
    ]
  }
];

// ---------------------------------------------------------------------------
// Validate and emit
// ---------------------------------------------------------------------------
const covered = new Map(); // type -> Set(variants used)
const errors = [];

for (const street of STREETS) {
  for (const [type, variantString] of street.segments) {
    const supported = segmentVariants[type];
    if (!supported) {
      errors.push(`${street.slug}: unknown segment type '${type}'`);
      continue;
    }
    if (!supported.includes(variantString)) {
      errors.push(`${street.slug}: unsupported variant '${type}' / '${variantString}'`);
    }
    if (!covered.has(type)) covered.set(type, new Set());
    covered.get(type).add(variantString);
  }
}

let totalVariants = 0;
let coveredVariants = 0;
for (const [type, variants] of Object.entries(segmentVariants)) {
  const unique = new Set(variants); // source list contains one duplicate
  totalVariants += unique.size;
  for (const v of unique) {
    if (covered.get(type)?.has(v)) coveredVariants++;
    else errors.push(`MISSING coverage: '${type}' / '${v}'`);
  }
}

if (errors.length) {
  console.error('Fixture generation failed:');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}

await mkdir(FIXTURES_DIR, { recursive: true });
for (const street of STREETS) {
  const segments = street.segments.map(([type, variantString, width]) => ({
    type,
    variantString,
    width: width ?? DEFAULT_WIDTHS[type],
    elevation: levelFor(type, variantString) * CURB_HEIGHT
  }));
  const fixture = {
    name: street.name,
    data: {
      street: {
        schemaVersion: SCHEMA_VERSION,
        units: 2,
        width: Number(segments.reduce((w, s) => w + s.width, 0).toFixed(3)),
        leftBuildingVariant: street.buildings[0],
        rightBuildingVariant: street.buildings[1],
        segments
      }
    }
  };
  await writeFile(
    join(FIXTURES_DIR, `${street.slug}.streetmix.json`),
    JSON.stringify(fixture, null, 2) + '\n'
  );
}

console.log(
  `Wrote ${STREETS.length} fixtures to ${FIXTURES_DIR}\n` +
    `Coverage: ${coveredVariants}/${totalVariants} variants across ${
      Object.keys(segmentVariants).length
    } segment types`
);
