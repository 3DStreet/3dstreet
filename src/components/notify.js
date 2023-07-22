/* global AFRAME */
var { Notyf } = require('../lib/notyf.min.js');

AFRAME.registerComponent('notify', {
  schema: {
    duration: { type: 'number', default: 2000 },
    ripple: { type: 'boolean', default: true },
    position: { 
      type: 'string', 
      default: {
        // x: left | center | right
        // y: top | center | bottom
        x: 'right',
        y: 'bottom'
      } 
    },
    dismissible: { type: 'boolean', default: false },
    errorMsg: {type: 'string', default: ''},
    successMsg: {type: 'string', default: ''}
  },
  init: function () {
    this.notify = new Notyf({
       // Set your global Notyf configuration here
      duration: this.data.duration,
      ripple: this.data.ripple,
      position: this.data.position,
      dismissible: this.data.dismissible
    });
  },
  successMsg: function (messageText) {
    if (messageText) this.notify.success(messageText);
  },
  errorMsg: function (messageText) {
    if (messageText) this.notify.error(messageText);
  },
  update: function (oldData) {
    const newErrorMsg = this.data.errorMsg;
    const newSuccessMsg = this.data.successMsg;
    // If `oldData` is empty, then this means we're in the initialization process.
    // No need to update.
    if (Object.keys(oldData).length === 0) { return; }
    this.successMsg(newSuccessMsg);
    this.errorMsg(newErrorMsg);
    this.data.errorMsg = '';
    this.data.successMsg = '';
  }
});