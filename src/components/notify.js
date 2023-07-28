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
        x: 'center',
        y: 'bottom'
      }
    },
    dismissible: { type: 'boolean', default: false },
    type: { type: 'string', default: 'info' },
    message: { type: 'string', default: '' }
  },
  init: function () {
    this.notify = new Notyf({
      types: [
        {
          type: 'info',
          background: 'blue',
          icon: false
        }
      ],
      // Set your global Notyf configuration here
      duration: this.data.duration,
      ripple: this.data.ripple,
      position: this.data.position,
      dismissible: this.data.dismissible
    });
    this.types = this.notify.options.types.map(messType => messType.type);
  },
  message: function (messageText, messageType = 'info') {
    if (messageText && this.types.includes(messageType)) {
      this.notify.open({
        type: messageType,
        message: messageText
      });
    }
  },
  update: function (oldData) {
    // If `oldData` is empty, then this means we're in the initialization process.
    // No need to update.
    if (Object.keys(oldData).length === 0) { return; }

    const newMessage = this.data.message;
    const messageType = this.data.type;

    if (newMessage && this.types.includes(messageType)) {
      this.message(newMessage, messageType);
      this.data.message = '';
    }
  }
});
