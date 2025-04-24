/**
 * Project Info component for 3DStreet
 * Stores information about the current project that can be used for reports and documentation
 */
AFRAME.registerComponent('project-info', {
  schema: {
    description: { type: 'string', default: '' },
    location: { type: 'string', default: '' },
    currentCondition: { type: 'string', default: '' },
    problemStatement: { type: 'string', default: '' },
    proposedSolutions: { type: 'string', default: '' }
  },

  init: function () {
    // Initialize timestamps
    console.log('Project info component initialized');
  },

  update: function (oldData) {
    console.log('Project info updated:', this.data);
  }
});
