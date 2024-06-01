/* global describe, xit */

require('approvals').mocha();
require('jsdom-global')();
var pretty = require('pretty');

const rewire = require('rewire');

const app = rewire('../../src/aframe-streetmix-parsers');
const processSegments = app.__get__('processSegments');

// const { processSegments } = require('../src/aframe-streetmix-parsers');
// const { isSidewalk } = require('../src/tested/aframe-streetmix-parsers-tested');

// const otherApp = rewire('../../src/tested/aframe-streetmix-parsers-tested');
// app.__set__('isSidewalk', otherApp.__get__('isSidewalk')); // rewire isSidewalk

const sampleInput = `
{"id":"03923530-96d7-11ea-8f6a-5fbe8747064d","namespacedId":44,"name":"Streetmix3D All Segment Cases Test","clientUpdatedAt":"2020-05-15T18:29:04.491Z","data":{"street":{"schemaVersion":22,"width":232,"id":"03923530-96d7-11ea-8f6a-5fbe8747064d","namespacedId":44,"units":2,"location":null,"userUpdated":true,"environment":"day","leftBuildingHeight":4,"rightBuildingHeight":3,"leftBuildingVariant":"narrow","rightBuildingVariant":"wide","segments":[{"type":"sidewalk","variantString":"dense","width":6,"randSeed":36223137},{"type":"sidewalk-tree","variantString":"big","width":2},{"type":"sidewalk-wayfinding","variantString":"large","width":4},{"type":"sidewalk-bench","variantString":"left","width":4},{"type":"sidewalk-bike-rack","variantString":"right|sidewalk-parallel","width":5},{"type":"bikeshare","variantString":"left|road","width":7},{"type":"transit-shelter","variantString":"left|street-level","width":9},{"type":"sidewalk-lamp","variantString":"right|modern","width":2},{"type":"bus-lane","variantString":"inbound|shared","width":12},{"type":"turn-lane","variantString":"inbound|left","width":10},{"type":"drive-lane","variantString":"inbound|sharrow","width":10,"randSeed":102670651},{"type":"turn-lane","variantString":"inbound|right","width":10},{"type":"divider","variantString":"bush","width":2},{"type":"drive-lane","variantString":"inbound|car","width":10,"randSeed":807672430},{"type":"turn-lane","variantString":"outbound|shared","width":10},{"type":"drive-lane","variantString":"outbound|car","width":10,"randSeed":365422905},{"type":"sidewalk-lamp","variantString":"both|pride","width":4},{"type":"divider","variantString":"bush","width":3},{"type":"sidewalk-lamp","variantString":"both|traditional","width":4},{"type":"streetcar","variantString":"inbound|grass","width":12},{"type":"light-rail","variantString":"outbound|colored","width":12},{"type":"bus-lane","variantString":"outbound|colored","width":12},{"type":"sidewalk-lamp","variantString":"left|pride","width":4},{"type":"divider","variantString":"bollard","width":2},{"type":"sidewalk-lamp","variantString":"right|pride","width":4},{"type":"turn-lane","variantString":"outbound|left","width":10},{"type":"turn-lane","variantString":"outbound|left-right-straight","width":10},{"type":"turn-lane","variantString":"outbound|right","width":10},{"type":"parking-lane","variantString":"outbound|right","width":7},{"type":"scooter","variantString":"outbound|regular","width":5},{"type":"sidewalk-lamp","variantString":"both|modern","width":4},{"type":"divider","variantString":"planter-box","width":4},{"type":"bike-lane","variantString":"inbound|red|road","width":6},{"type":"bike-lane","variantString":"outbound|green|road","width":6},{"type":"sidewalk-lamp","variantString":"left|modern","width":2},{"type":"sidewalk-tree","variantString":"palm-tree","width":2},{"type":"sidewalk","variantString":"normal","width":6,"randSeed":419985576}],"editCount":61}},"createdAt":"2020-05-15T18:08:01.084Z","updatedAt":"2020-05-15T18:29:05.292Z","originalStreetId":null,"creator":{"id":"kfarr"}}
`;

function overrideMathRandomForTesting () {
  return app.__set__('randomTestable', function () { return 0.5; });
}

function prepareParentElement (id) {
  const parentEl = document.createElement('a-entity');
  parentEl.setAttribute('id', id);
  document.body.appendChild(parentEl);
  return parentEl;
}

describe('ApprovalTest - A-Frame Streetmix', function () {
  describe('#processSegments() Street 44', function () {
    xit('should generate the same output when passing an example JSON', function () {
      const elementId = 'streets';

      const parentEl = prepareParentElement(elementId);
      const streetmixObject = JSON.parse(sampleInput);
      overrideMathRandomForTesting();

      processSegments(streetmixObject.data.street.segments, elementId);

      this.verify(pretty(parentEl.innerHTML), { normalizeLineEndingsTo: '\r\n' });
    });
  });
});
