/* global AFRAME */
import useStore from '../store.js';

const streetURL = window.location.hash.substring(1);
let labelHeight = 2.5;
if (streetURL.includes('streetplan.net/')) {
  labelHeight = 3.5;
}

AFRAME.registerComponent('street-label', {
  dependencies: ['managed-street', 'street-align'],

  schema: {
    enabled: { type: 'boolean', default: true },
    heightOffset: { type: 'number', default: -2 },
    rotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    zOffset: { type: 'number', default: 1 },
    labelHeight: { type: 'number', default: labelHeight },
    baseCanvasWidth: { type: 'number', default: 4096 }
  },

  init: function () {
    // Get initial units preference from store
    this.units = useStore.getState().unitsPreference || 'metric';

    // Subscribe to units preference changes
    useStore.subscribe((state) => {
      if (this.units !== state.unitsPreference) {
        this.units = state.unitsPreference;
        this.updateLabels();
      }
    });
    this.createdEntities = [];
    this.canvas = null;
    this.ctx = null;
    this.canvasId = `street-label-canvas-${Math.random().toString(36).substr(2, 9)}`;

    // Create and setup canvas
    this.createAndSetupCanvas();

    // Listen for segment & alignment changes
    this.updateLabels = this.updateLabels.bind(this);
    this.el.addEventListener('segments-changed', this.updateLabels);
    this.el.addEventListener('alignment-changed', this.updateLabels);

    // Handle loading from saved scene
    setTimeout(() => {
      if (this.data.enabled) {
        this.updateLabels();
      }
    }, 0);
  },

  update: function (oldData) {
    if (oldData && this.data.enabled !== oldData.enabled) {
      if (!this.data.enabled) {
        // Hide existing labels
        this.createdEntities.forEach((entity) => {
          entity.setAttribute('visible', false);
        });
      } else {
        // Show and update labels
        this.createdEntities.forEach((entity) => {
          entity.setAttribute('visible', true);
        });
        this.updateLabels();
      }
    } else if (this.data.enabled) {
      this.updateLabels();
    }
  },

  updateLabels: function () {
    const segments = Array.from(this.el.querySelectorAll('[street-segment]'));
    if (segments.length === 0) return;

    const widthsArray = [];
    const labelsArray = [];
    const rulerawid = [];
    const rulerawididx = [];
    const rulerawidArray = [];
    const ruleralabelArray = [];
    const rulerbwid = [];
    const rulerbwididx = [];
    const rulerbwidArray = [];
    const rulerblabelArray = [];

    const rulerdata = {
      r19: 'Land Use',
      r1901: 'Buildings',
      r27: 'Land Use',
      r2701: 'Buildings',
      r19coc: '#223c22',
      r1901coc: '#223c22',
      r27coc: '#223c22',
      r2701coc: '#223c22',
      r20: 'Setback',
      r2001: 'Setback',
      r21: 'Roadside',
      r2100: 'Bld Frontage',
      r2101: 'Sidewalk',
      r2102: 'Buffer',
      r2103: 'Bike',
      r210301: 'Slow',
      r210302: 'Edge',
      r2104: 'Other 1',
      r2105: 'Other 2',
      r22: 'Frontage',
      r2201: 'Bike',
      r220101: 'Slow',
      r2202: 'Angle Parking',
      r2203: 'Parking',
      r2204: 'Buffer + Access',
      r2205: 'Other',
      r23: 'Curb to Curb',
      r2300: 'Curb to Curb',
      r2301: 'Shoulder',
      r2302: 'Parking',
      r2303: 'Angle Parking',
      r230301: 'Reverse Parking',
      r2304: 'Park + Bike',
      r2305: 'Travel Lanes',
      r2306: 'Transit',
      r2307: 'Buffer',
      r2308: 'Bike',
      r230801: 'Slow Zone',
      r2309: 'Other 1',
      r2310: 'Other 2',
      r2320: 'Median',
      r2330: 'Curb to Curb',
      r2331: 'Shoulder',
      r2332: 'Parking',
      r2333: 'Angle Parking',
      r233301: 'Reverse Parking',
      r2334: 'Park + Bike',
      r2335: 'Travel Lanes',
      r2336: 'Transit',
      r2337: 'Buffer',
      r2338: 'Bike',
      r233801: 'Slow Zone',
      r2339: 'Other 1',
      r2340: 'Other 2',
      r24: 'Frontage',
      r2401: 'Bike',
      r240101: 'Slow',
      r2402: 'Angle Parking',
      r2403: 'Parking',
      r2404: 'Buffer + Access',
      r2405: 'Other',
      r25: 'Roadside',
      r2500: 'Bld Frontage',
      r2501: 'Sidewalk',
      r2502: 'Buffer',
      r2503: 'Bike',
      r250301: 'Slow',
      r250302: 'Edge',
      r2504: 'Other 1',
      r2505: 'Other 2',
      r26: 'Setback',
      r2601: 'Setback',
      r20a: '',
      r2001a: 'SB',
      r21a: 'Side',
      r2100a: 'Fr',
      r2101a: 'Walk',
      r2102a: 'Buf',
      r2103a: 'Bike',
      r210301a: 'LSV',
      r210302a: 'Ed',
      r2104a: 'NA',
      r2105a: 'NA',
      r22a: '',
      r2201a: 'Bike',
      r220101a: 'LSV',
      r2202a: 'A. Park',
      r2203a: 'P. Park',
      r2204a: 'Buf. + Acc.',
      r2205a: 'NA',
      r23a: '',
      r2300a: '',
      r2301a: 'Shld',
      r2302a: 'P. Park',
      r2303a: 'A. Park',
      r230301a: 'R. Park',
      r2304a: 'Park + Bike',
      r2305a: 'Lanes',
      r2306a: 'Tran.',
      r2307a: 'Buf',
      r2308a: 'Bike',
      r230801a: 'Slow',
      r2309a: 'NA',
      r2310a: 'NA',
      r2320a: 'Med',
      r2330a: '',
      r2331a: 'Shld',
      r2332a: 'P. Park',
      r2333a: 'A. Park',
      r233301a: 'R. Park',
      r2334a: 'Park + Bike',
      r2335a: 'Lanes',
      r2336a: 'Tran.',
      r2337a: 'Buf',
      r2338a: 'Bike',
      r233801a: 'Slow',
      r2339a: 'NA',
      r2340a: 'NA',
      r24a: '',
      r2401a: 'Bike',
      r240101a: 'LSV',
      r2402a: 'A. Park',
      r2403a: 'P. Park',
      r2404a: 'Buf. + Acc.',
      r2405a: 'NA',
      r25a: 'Side',
      r2500a: 'Fr',
      r2501a: 'Walk',
      r2502a: 'Buf',
      r2503a: 'Bike',
      r250301a: 'LSV',
      r250302a: 'Ed',
      r2504a: 'NA',
      r2505a: 'NA',
      r26a: '',
      r2601a: 'SB',
      r20c: '0',
      r2001c: '0',
      r21c: '1',
      r2100c: '1',
      r2101c: '1',
      r2102c: '1',
      r2103c: '1',
      r210301c: '1',
      r210302c: '1',
      r2104c: '0',
      r2105c: '0',
      r22c: '0',
      r2201c: '0',
      r220101c: '0',
      r2202c: '0',
      r2203c: '0',
      r2204c: '0',
      r2205c: '0',
      r23c: '1',
      r2300c: '1',
      r2301c: '1',
      r2302c: '1',
      r2303c: '1',
      r230301c: '1',
      r2304c: '1',
      r2305c: '1',
      r2306c: '1',
      r2307c: '1',
      r2308c: '1',
      r230801c: '1',
      r2309c: '0',
      r2310c: '0',
      r2320c: '1',
      r2330c: '1',
      r2331c: '1',
      r2332c: '1',
      r2333c: '1',
      r233301c: '1',
      r2334c: '1',
      r2335c: '1',
      r2336c: '1',
      r2337c: '1',
      r2338c: '1',
      r233801c: '1',
      r2339c: '0',
      r2340c: '0',
      r24c: '0',
      r2401c: '0',
      r240101c: '0',
      r2402c: '0',
      r2403c: '0',
      r2404c: '0',
      r2405c: '0',
      r25c: '1',
      r2500c: '1',
      r2501c: '1',
      r2502c: '1',
      r2503c: '1',
      r250301c: '1',
      r250302c: '1',
      r2504c: '0',
      r2505c: '0',
      r26c: '0',
      r2601c: '0',
      r20coc: '#223c22',
      r2001coc: '#223c22',
      r21coc: '#223c22',
      r2100coc: '#30522E',
      r2101coc: '#223c22',
      r2102coc: '#223c22',
      r2103coc: '#223c22',
      r210301coc: '#223c22',
      r210302coc: '#555555',
      r2104coc: '#808080',
      r2105coc: '#3c810b',
      r22coc: '#808080',
      r2201coc: '#032337',
      r220101coc: '#032337',
      r2202coc: '#080000',
      r2203coc: '#080000',
      r2204coc: '#223c22',
      r2205coc: '#808080',
      r23coc: '#080000',
      r2300coc: '#080000',
      r2301coc: '#080000',
      r2302coc: '#080000',
      r2303coc: '#080000',
      r230301coc: '#080000',
      r2304coc: '#032337',
      r2305coc: '#080000',
      r2306coc: '#080000',
      r2307coc: '#223c22',
      r2308coc: '#032337',
      r230801coc: '#467743',
      r2309coc: '#808080',
      r2310coc: '#808080',
      r2320coc: '#080000',
      r2330coc: '#080000',
      r2331coc: '#080000',
      r2332coc: '#080000',
      r2333coc: '#080000',
      r233301coc: '#080000',
      r2334coc: '#032337',
      r2335coc: '#080000',
      r2336coc: '#080000',
      r2337coc: '#223c22',
      r2338coc: '#032337',
      r233801coc: '#467743',
      r2339coc: '#808080',
      r2340coc: '#808080',
      r24coc: '#808080',
      r2401coc: '#032337',
      r240101coc: '#032337',
      r2402coc: '#080000',
      r2403coc: '#080000',
      r2404coc: '#223c22',
      r2405coc: '#808080',
      r25coc: '#223c22',
      r2500coc: '#30522E',
      r2501coc: '#223c22',
      r2502coc: '#223c22',
      r2503coc: '#032337',
      r250301coc: '#223c22',
      r250302coc: '#555555',
      r2504coc: '#808080',
      r2505coc: '#3c810b',
      r26coc: '#223c22',
      r2601coc: '#223c22',
      leftsidec: 'L',
      rightsidec: 'R'
    };
    segments.forEach((segmentEl) => {
      const segmentWidth = segmentEl.getAttribute('street-segment')?.width;
      if (!segmentWidth) return;

      widthsArray.push(segmentWidth);
      labelsArray.push(segmentEl.getAttribute('data-layer-name') || '');

      if (streetURL.includes('streetplan.net/')) {
        if (
          rulerawid[segmentEl.getAttribute('data-layer-rulergrpa')] ===
          undefined
        ) {
          rulerawid[segmentEl.getAttribute('data-layer-rulergrpa')] =
            segmentEl.getAttribute('data-layer-rulergrpa');
          rulerawidArray.push(
            parseFloat(segmentEl.getAttribute('data-layer-rulergrpaw'))
          );
          let widthFT =
            parseFloat(segmentEl.getAttribute('data-layer-rulergrpaw')) *
            3.2808;
          let lengthRU =
            rulerdata[segmentEl.getAttribute('data-layer-rulergrpa')].length;
          if (widthFT < lengthRU) {
            ruleralabelArray.push(
              rulerdata[segmentEl.getAttribute('data-layer-rulergrpa') + 'a'] ||
                ''
            );
          } else {
            ruleralabelArray.push(
              rulerdata[segmentEl.getAttribute('data-layer-rulergrpa')] || ''
            );
          }
          rulerawididx.push(segmentEl.getAttribute('data-layer-rulergrpa'));
        }
        if (
          rulerbwid[segmentEl.getAttribute('data-layer-rulergrpb')] ===
          undefined
        ) {
          rulerbwid[segmentEl.getAttribute('data-layer-rulergrpb')] =
            segmentEl.getAttribute('data-layer-rulergrpb');
          rulerbwidArray.push(
            parseFloat(segmentEl.getAttribute('data-layer-rulergrpbw'))
          );
          let rulerbprefix = '';
          if (
            segmentEl.getAttribute('data-layer-rulergrpb') === 'r21' ||
            segmentEl.getAttribute('data-layer-rulergrpb') === 'r22'
          ) {
            rulerbprefix =
              segmentEl.getAttribute('data-layer-leftsidec') + '. ';
          } else if (
            segmentEl.getAttribute('data-layer-rulergrpb') === 'r25' ||
            segmentEl.getAttribute('data-layer-rulergrpb') === 'r24'
          ) {
            rulerbprefix =
              segmentEl.getAttribute('data-layer-rightsidec') + '. ';
          }
          let widthFT =
            parseFloat(segmentEl.getAttribute('data-layer-rulergrpbw')) *
            3.2808;
          let lengthRU =
            rulerdata[segmentEl.getAttribute('data-layer-rulergrpb')].length *
            1.5;
          if (widthFT < lengthRU) {
            rulerblabelArray.push(
              rulerbprefix +
                rulerdata[
                  segmentEl.getAttribute('data-layer-rulergrpb') + 'a'
                ] || ''
            );
          } else {
            rulerblabelArray.push(
              rulerbprefix +
                rulerdata[segmentEl.getAttribute('data-layer-rulergrpb')] || ''
            );
          }
          rulerbwididx.push(segmentEl.getAttribute('data-layer-rulergrpb'));
        }
      }
    });

    if (widthsArray.length !== labelsArray.length) {
      console.error('Mismatch between widths and labels arrays');
      return;
    }

    const totalWidth = rulerawidArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    if (streetURL.includes('streetplan.net/')) {
      this.updateCanvasDimensions(totalWidth);
      this.spdrawLabels(
        widthsArray,
        labelsArray,
        totalWidth,
        rulerawidArray,
        ruleralabelArray,
        rulerbwidArray,
        rulerblabelArray,
        rulerawididx,
        rulerbwididx
      );
      this.createLabelPlane(totalWidth);
    } else {
      this.updateCanvasDimensions(totalWidth);
      this.drawLabels(widthsArray, labelsArray, totalWidth);
      this.createLabelPlane(totalWidth);
    }
  },
  spdrawLabels: function (
    widthsArray,
    labelsArray,
    totalWidth,
    rulerawidArray,
    ruleralabelArray,
    rulerbwidArray,
    rulerblabelArray,
    rulerawididx,
    rulerbwididx
  ) {
    const { ctx, canvas } = this;
    const rulerdata = {
      r19: 'Land Use',
      r1901: 'Land Use',
      r27: 'Land Use',
      r2701: 'Land Use',
      r19coc: '#223c22',
      r1901coc: '#223c22',
      r27coc: '#223c22',
      r2701coc: '#223c22',
      r20: 'Setback',
      r2001: 'Setback',
      r21: 'Roadside',
      r2100: 'Bld Frontage',
      r2101: 'Sidewalk',
      r2102: 'Buffer',
      r2103: 'Bike',
      r210301: 'Slow',
      r210302: 'Edge',
      r2104: 'Other 1',
      r2105: 'Other 2',
      r22: 'Frontage',
      r2201: 'Bike',
      r220101: 'Slow',
      r2202: 'Angle Parking',
      r2203: 'Parking',
      r2204: 'Buffer + Access',
      r2205: 'Other',
      r23: 'Curb to Curb',
      r2300: 'Curb to Curb',
      r2301: 'Shoulder',
      r2302: 'Parking',
      r2303: 'Angle Parking',
      r230301: 'Reverse Parking',
      r2304: 'Park + Bike',
      r2305: 'Travel Lanes',
      r2306: 'Transit',
      r2307: 'Buffer',
      r2308: 'Bike',
      r230801: 'Slow Zone',
      r2309: 'Other 1',
      r2310: 'Other 2',
      r2320: 'Median',
      r2330: 'Curb to Curb',
      r2331: 'Shoulder',
      r2332: 'Parking',
      r2333: 'Angle Parking',
      r233301: 'Reverse Parking',
      r2334: 'Park + Bike',
      r2335: 'Travel Lanes',
      r2336: 'Transit',
      r2337: 'Buffer',
      r2338: 'Bike',
      r233801: 'Slow Zone',
      r2339: 'Other 1',
      r2340: 'Other 2',
      r24: 'Frontage',
      r2401: 'Bike',
      r240101: 'Slow',
      r2402: 'Angle Parking',
      r2403: 'Parking',
      r2404: 'Buffer + Access',
      r2405: 'Other',
      r25: 'Roadside',
      r2500: 'Bld Frontage',
      r2501: 'Sidewalk',
      r2502: 'Buffer',
      r2503: 'Bike',
      r250301: 'Slow',
      r250302: 'Edge',
      r2504: 'Other 1',
      r2505: 'Other 2',
      r26: 'Setback',
      r2601: 'Setback',
      r20a: '',
      r2001a: 'SB',
      r21a: 'Side',
      r2100a: 'Fr',
      r2101a: 'Walk',
      r2102a: 'Buf',
      r2103a: 'Bike',
      r210301a: 'LSV',
      r210302a: 'Ed',
      r2104a: 'NA',
      r2105a: 'NA',
      r22a: '',
      r2201a: 'Bike',
      r220101a: 'LSV',
      r2202a: 'A. Park',
      r2203a: 'P. Park',
      r2204a: 'Buf. + Acc.',
      r2205a: 'NA',
      r23a: '',
      r2300a: '',
      r2301a: 'Shld',
      r2302a: 'P. Park',
      r2303a: 'A. Park',
      r230301a: 'R. Park',
      r2304a: 'Park + Bike',
      r2305a: 'Lanes',
      r2306a: 'Tran.',
      r2307a: 'Buf',
      r2308a: 'Bike',
      r230801a: 'Slow',
      r2309a: 'NA',
      r2310a: 'NA',
      r2320a: 'Med',
      r2330a: '',
      r2331a: 'Shld',
      r2332a: 'P. Park',
      r2333a: 'A. Park',
      r233301a: 'R. Park',
      r2334a: 'Park + Bike',
      r2335a: 'Lanes',
      r2336a: 'Tran.',
      r2337a: 'Buf',
      r2338a: 'Bike',
      r233801a: 'Slow',
      r2339a: 'NA',
      r2340a: 'NA',
      r24a: '',
      r2401a: 'Bike',
      r240101a: 'LSV',
      r2402a: 'A. Park',
      r2403a: 'P. Park',
      r2404a: 'Buf. + Acc.',
      r2405a: 'NA',
      r25a: 'Side',
      r2500a: 'Fr',
      r2501a: 'Walk',
      r2502a: 'Buf',
      r2503a: 'Bike',
      r250301a: 'LSV',
      r250302a: 'Ed',
      r2504a: 'NA',
      r2505a: 'NA',
      r26a: '',
      r2601a: 'SB',
      r20c: '0',
      r2001c: '0',
      r21c: '1',
      r2100c: '1',
      r2101c: '1',
      r2102c: '1',
      r2103c: '1',
      r210301c: '1',
      r210302c: '1',
      r2104c: '0',
      r2105c: '0',
      r22c: '0',
      r2201c: '0',
      r220101c: '0',
      r2202c: '0',
      r2203c: '0',
      r2204c: '0',
      r2205c: '0',
      r23c: '1',
      r2300c: '1',
      r2301c: '1',
      r2302c: '1',
      r2303c: '1',
      r230301c: '1',
      r2304c: '1',
      r2305c: '1',
      r2306c: '1',
      r2307c: '1',
      r2308c: '1',
      r230801c: '1',
      r2309c: '0',
      r2310c: '0',
      r2320c: '1',
      r2330c: '1',
      r2331c: '1',
      r2332c: '1',
      r2333c: '1',
      r233301c: '1',
      r2334c: '1',
      r2335c: '1',
      r2336c: '1',
      r2337c: '1',
      r2338c: '1',
      r233801c: '1',
      r2339c: '0',
      r2340c: '0',
      r24c: '0',
      r2401c: '0',
      r240101c: '0',
      r2402c: '0',
      r2403c: '0',
      r2404c: '0',
      r2405c: '0',
      r25c: '1',
      r2500c: '1',
      r2501c: '1',
      r2502c: '1',
      r2503c: '1',
      r250301c: '1',
      r250302c: '1',
      r2504c: '0',
      r2505c: '0',
      r26c: '0',
      r2601c: '0',
      r20coc: '#223c22',
      r2001coc: '#223c22',
      r21coc: '#223c22',
      r2100coc: '#30522E',
      r2101coc: '#223c22',
      r2102coc: '#223c22',
      r2103coc: '#223c22',
      r210301coc: '#223c22',
      r210302coc: '#555555',
      r2104coc: '#808080',
      r2105coc: '#3c810b',
      r22coc: '#808080',
      r2201coc: '#032337',
      r220101coc: '#032337',
      r2202coc: '#080000',
      r2203coc: '#080000',
      r2204coc: '#223c22',
      r2205coc: '#808080',
      r23coc: '#080000',
      r2300coc: '#080000',
      r2301coc: '#080000',
      r2302coc: '#080000',
      r2303coc: '#080000',
      r230301coc: '#080000',
      r2304coc: '#032337',
      r2305coc: '#080000',
      r2306coc: '#080000',
      r2307coc: '#223c22',
      r2308coc: '#032337',
      r230801coc: '#467743',
      r2309coc: '#808080',
      r2310coc: '#808080',
      r2320coc: '#080000',
      r2330coc: '#080000',
      r2331coc: '#080000',
      r2332coc: '#080000',
      r2333coc: '#080000',
      r233301coc: '#080000',
      r2334coc: '#032337',
      r2335coc: '#080000',
      r2336coc: '#080000',
      r2337coc: '#223c22',
      r2338coc: '#032337',
      r233801coc: '#467743',
      r2339coc: '#808080',
      r2340coc: '#808080',
      r24coc: '#808080',
      r2401coc: '#032337',
      r240101coc: '#032337',
      r2402coc: '#080000',
      r2403coc: '#080000',
      r2404coc: '#223c22',
      r2405coc: '#808080',
      r25coc: '#223c22',
      r2500coc: '#30522E',
      r2501coc: '#223c22',
      r2502coc: '#223c22',
      r2503coc: '#032337',
      r250301coc: '#223c22',
      r250302coc: '#555555',
      r2504coc: '#808080',
      r2505coc: '#3c810b',
      r26coc: '#223c22',
      r2601coc: '#223c22',
      leftsidec: 'L',
      rightsidec: 'R'
    };

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let currentX = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    widthsArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;

      // Draw segment background
      ctx.fillStyle = index % 2 === 0 ? '#f0f0f0' : '#e0e0e0';
      ctx.fillRect(currentX, 0, segmentWidth, canvas.height / 4);

      // Draw segment border
      ctx.strokeStyle = '#999999';
      ctx.beginPath();
      ctx.moveTo(currentX, 0);
      ctx.lineTo(currentX, canvas.height / 4);
      ctx.stroke();

      // Draw width value
      ctx.fillStyle = '#000000';
      ctx.font = `${this.subFontSize}px Arial`;
      const centerX = currentX + segmentWidth / 2;

      let widthText;
      if (this.units === 'metric') {
        widthText =
          (Math.round(width * 10) / 10).toString().replace(/^0+/, '') + '';
      } else if (this.units === 'imperial') {
        const widthFeet = width * 3.28084;
        widthText = Math.round(widthFeet * 2) / 2 + '';
      }
      ctx.fillText(widthText, centerX, canvas.height / 7);
      currentX += segmentWidth;
    });

    currentX = 0;
    rulerawidArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;

      // Draw segment background
      if (rulerdata[rulerawididx[index] + 'coc'] !== undefined) {
        ctx.fillStyle = rulerdata[rulerawididx[index] + 'coc'];
      } else {
        ctx.fillStyle = '#272424';
      }
      ctx.fillRect(
        currentX,
        canvas.height / 4,
        segmentWidth,
        (canvas.height * 3) / 4 / 2
      );

      // Draw segment border
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(currentX, canvas.height / 4);
      ctx.lineTo(currentX, canvas.height / 4 + (canvas.height * 3) / 4 / 2);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `${this.fontSize}px Arial`;
      const centerX = currentX + segmentWidth / 2;

      let widthText;
      if (this.units === 'metric') {
        widthText =
          (Math.round(width * 10) / 10).toString().replace(/^0+/, '') + '';
      } else if (this.units === 'imperial') {
        const widthFeet = width * 3.28084;
        widthText = Math.round(widthFeet * 2) / 2 + '';
      }

      // Draw wrapped label text
      if (ruleralabelArray[index]) {
        ctx.font = `${this.subFontSize}px Arial`;
        ctx.fillText(
          widthText,
          centerX,
          canvas.height / 4 + (canvas.height * 3) / 4 / 2 - this.fontSize * 1.4
        );
        ctx.fillText(
          ruleralabelArray[index],
          centerX,
          canvas.height / 4 + (canvas.height * 3) / 4 / 2 - this.fontSize / 2
        );
      }

      currentX += segmentWidth;
    });

    currentX = 0;
    rulerbwidArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;

      // Draw segment background
      if (rulerdata[rulerbwididx[index] + 'coc'] !== undefined) {
        ctx.fillStyle = rulerdata[rulerbwididx[index] + 'coc'];
      } else {
        ctx.fillStyle = '#f0f0f0';
      }
      ctx.fillRect(
        currentX,
        canvas.height / 4 + (canvas.height * 3) / 4 / 2,
        segmentWidth,
        canvas.height
      );

      // Draw segment border
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(currentX, canvas.height / 4 + (canvas.height * 3) / 4 / 2);
      ctx.lineTo(currentX, canvas.height);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `${this.fontSize}px Arial`;
      const centerX = currentX + segmentWidth / 2;

      let widthText;
      if (this.units === 'metric') {
        widthText =
          (Math.round(width * 10) / 10).toString().replace(/^0+/, '') + '';
      } else if (this.units === 'imperial') {
        const widthFeet = width * 3.28084;
        widthText = Math.round(widthFeet * 2) / 2 + '';
      }

      // Draw wrapped label text
      if (rulerblabelArray[index]) {
        ctx.font = `${this.fontSize}px Arial`;
        ctx.fillText(widthText, centerX, canvas.height - this.fontSize * 1.4);
        ctx.fillText(
          rulerblabelArray[index],
          centerX,
          canvas.height - this.fontSize / 2
        );
      }

      currentX += segmentWidth;
    });

    // Draw final border
    ctx.strokeStyle = '#999999';
    ctx.beginPath();
    ctx.moveTo(canvas.width, 0);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.stroke();
  },

  createAndSetupCanvas: function () {
    this.canvas = document.createElement('canvas');
    this.canvas.id = this.canvasId;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  },

  updateCanvasDimensions: function (totalWidth) {
    const aspectRatio = totalWidth / this.data.labelHeight;

    this.canvas.width = this.data.baseCanvasWidth;
    this.canvas.height = Math.round(this.data.baseCanvasWidth / aspectRatio);

    this.fontSize = Math.round(this.canvas.height * 0.18);
    this.subFontSize = Math.round(this.canvas.height * 0.14);
  },

  wrapText: function (text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = this.ctx.measureText(currentLine + ' ' + word).width;

      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    return lines;
  },

  drawMultilineText: function (lines, x, y, lineHeight) {
    const totalHeight = (lines.length - 1) * lineHeight;
    const startY = y - totalHeight / 2;

    lines.forEach((line, index) => {
      const yPos = startY + index * lineHeight;
      this.ctx.fillText(line, x, yPos);
    });
  },

  drawLabels: function (widthsArray, labelsArray, totalWidth) {
    const { ctx, canvas } = this;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let currentX = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    widthsArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;
      const maxLabelWidth = segmentWidth * 0.9;

      // Draw segment background
      ctx.fillStyle = index % 2 === 0 ? '#f0f0f0' : '#e0e0e0';
      ctx.fillRect(currentX, 0, segmentWidth, canvas.height);

      // Draw segment border
      ctx.strokeStyle = '#999999';
      ctx.beginPath();
      ctx.moveTo(currentX, 0);
      ctx.lineTo(currentX, canvas.height);
      ctx.stroke();

      // Draw width value
      ctx.fillStyle = '#000000';
      ctx.font = `${this.fontSize}px Arial`;
      const centerX = currentX + segmentWidth / 2;
      const centerY = canvas.height / 2 - 30;

      let widthText;
      if (this.units === 'metric') {
        widthText = parseFloat(width).toFixed(1) + 'm';
      } else if (this.units === 'imperial') {
        const widthFeet = width * 3.28084;
        widthText = parseFloat(widthFeet).toFixed(1) + 'ft';
      }
      ctx.fillText(widthText, centerX, centerY - this.fontSize * 0.8);

      // Draw wrapped label text
      if (labelsArray[index]) {
        ctx.font = `${this.subFontSize}px Arial`;
        const lines = this.wrapText(labelsArray[index], maxLabelWidth);
        const lineHeight = this.subFontSize * 1.2;
        this.drawMultilineText(
          lines,
          centerX,
          centerY + this.fontSize * 0.4 + 65,
          lineHeight
        );
      }

      currentX += segmentWidth;
    });

    // Draw final border
    ctx.strokeStyle = '#999999';
    ctx.beginPath();
    ctx.moveTo(canvas.width, 0);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.stroke();
  },

  createLabelPlane: function (totalWidth) {
    // Remove existing entities
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];

    // Create new label plane
    const plane = document.createElement('a-entity');

    plane.setAttribute('geometry', {
      primitive: 'plane',
      width: totalWidth,
      height: this.data.labelHeight
    });

    plane.setAttribute('material', {
      src: `#${this.canvasId}`,
      transparent: true,
      alphaTest: 0.5
    });

    // Get alignment from street-align component
    const streetAlign = this.el.components['street-align'];
    const alignWidth = streetAlign?.data.width || 'center';
    const alignLength = streetAlign?.data.length || 'start';

    // Get street length from managed-street component
    const streetLength = this.el.getAttribute('managed-street')?.length || 0;

    // Calculate x position based on width alignment
    let xPosition = 0;
    if (alignWidth === 'center') {
      xPosition = 0;
    } else if (alignWidth === 'left') {
      xPosition = totalWidth / 2;
    } else if (alignWidth === 'right') {
      xPosition = -totalWidth / 2;
    }

    // Calculate z position based on length alignment
    let zPosition = this.data.zOffset; // for 'start' alignment
    if (alignLength === 'middle') {
      zPosition = streetLength / 2 + this.data.zOffset;
    } else if (alignLength === 'end') {
      zPosition = streetLength + this.data.zOffset;
    }

    plane.setAttribute(
      'position',
      `${xPosition} ${this.data.heightOffset} ${zPosition}`
    );
    plane.setAttribute(
      'rotation',
      `${this.data.rotation.x} ${this.data.rotation.y} ${this.data.rotation.z}`
    );
    plane.setAttribute('data-layer-name', 'Segment Labels');
    plane.classList.add('autocreated');

    this.el.appendChild(plane);
    this.createdEntities.push(plane);
  },

  remove: function () {
    // Clean up canvas
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    // Remove created entities
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];

    // Remove event listener
    this.el.removeEventListener('segments-changed', this.updateLabels);
    this.el.removeEventListener('alignment-changed', this.updateLabels);
  }
});
