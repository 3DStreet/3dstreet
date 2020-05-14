/* global describe, it */

require('approvals').mocha();
require('jsdom-global')();

const rewire = require('rewire');

const app = rewire('../../src/aframe-streetmix-parsers');
const otherApp = rewire('../../src/tested/aframe-streetmix-tested');
app.__set__('isSidewalk', otherApp.__get__('isSidewalk')); // rewire isSidewalk

const processSegments = app.__get__('processSegments');

const sampleInput = `
{
  "id":"5043b130-44be-11ea-ae58-ad57273c416e",
  "namespacedId":34,
  "name":"Market Street at 11th w bikeshare",
  "clientUpdatedAt":"2020-05-13T16:13:15.864Z",
  "data":{
    "street":{
      "schemaVersion":22,
      "width":101.33333333333333,
      "id":"5043b130-44be-11ea-ae58-ad57273c416e",
      "namespacedId":34,
      "units":2,
      "location":null,
      "userUpdated":true,
      "environment":"day",
      "leftBuildingHeight":4,
      "rightBuildingHeight":20,
      "leftBuildingVariant":"narrow",
      "rightBuildingVariant":"waterfront",
      "segments":[
        {
          "type":"sidewalk",
          "variantString":"dense",
          "width":11.66667,
          "randSeed":496622137
        
},
        {
          "type":"sidewalk-bench",
          "variantString":"left",
          "width":1
        
},
        {
          "type":"sidewalk-tree",
          "variantString":"big",
          "width":2
        
},
        {
          "type":"sidewalk-bike-rack",
          "variantString":"right|sidewalk",
          "width":6.66667
        
},
        {
          "type":"sidewalk-lamp",
          "variantString":"both|traditional",
          "width":2
        
},
        {
          "type":"bike-lane",
          "variantString":"inbound|green|road",
          "width":5
        
},
        {
          "type":"divider",
          "variantString":"bollard",
          "width":2
        
},
        {
          "type":"drive-lane",
          "variantString":"inbound|car",
          "width":10,
          "randSeed":522044056
        
},
        {
          "type":"divider",
          "variantString":"striped-buffer",
          "width":1.66667
        
},
        {
          "type":"streetcar",
          "variantString":"inbound|colored",
          "width":12
        
},
        {
          "type":"light-rail",
          "variantString":"outbound|colored",
          "width":12
        
},
        {
          "type":"divider",
          "variantString":"striped-buffer",
          "width":1.66667
        
},
        {
          "type":"bike-lane",
          "variantString":"outbound|green|road",
          "width":5
        
},
        {
          "type":"divider",
          "variantString":"bollard",
          "width":2
        
},
        {
          "type":"turn-lane",
          "variantString":"outbound|left-right-straight",
          "width":10
        
},
        {
          "type":"sidewalk",
          "variantString":"dense",
          "width":1.66667,
          "randSeed":706037020
        
},
        {
          "type":"sidewalk-lamp",
          "variantString":"both|traditional",
          "width":2
        
},
        {
          "type":"sidewalk-tree",
          "variantString":"big",
          "width":1
        
},
        {
          "type":"sidewalk-bench",
          "variantString":"right",
          "width":1
        
},
        {
          "type":"bikeshare",
          "variantString":"left|sidewalk",
          "width":7
        
},
        {
          "type":"sidewalk",
          "variantString":"normal",
          "width":9.33333,
          "randSeed":401817574
        
}
      
],
      "editCount":117
    
}
  
},
  "createdAt":"2020-02-01T06:44:36.952Z",
  "updatedAt":"2020-05-13T16:13:16.700Z",
  "originalStreetId":"5e4d0430-448b-11ea-ae58-ad57273c416e",
  "creator":{
    "id":"kfarr"
  
}
}
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
  describe('#processSegments()', function () {
    it('should generate the same output when passing an example JSON', function () {
      const elementId = 'streets';

      const parentEl = prepareParentElement(elementId);
      const streetmixObject = JSON.parse(sampleInput);
      overrideMathRandomForTesting();

      processSegments(streetmixObject.data.street.segments, elementId);

      this.verify(parentEl.innerHTML);
    });
  });
});
