/* global AFRAME, STREET */

/**
 * Scene Timer Component
 * A global timer component that manages time for the entire scene.
 * Provides play, pause, stop functionality and timing information.
 */
AFRAME.registerComponent('scene-timer', {
  schema: {
    autoStart: { type: 'boolean', default: false },
    format: { type: 'string', default: 'mm:ss:ff' } // mm:ss:ff, ss:ms, or raw
  },

  init: function () {
    // Initialize timer state
    this.elapsedTime = 0; // Time in milliseconds
    this.startTime = null; // Will hold the tick time when timer starts
    this.lastTickTime = null; // Will track the last tick time received
    this.isPlaying = false;
    this.frameRate = 30; // Assumed frame rate for frame count
    // Register timer event handlers
    this.bindEvents();

    // Auto-start if configured
    if (this.data.autoStart) {
      this.play();
    }

    // Register this component in the global STREET object if available
    if (typeof STREET !== 'undefined') {
      if (!STREET.timer) {
        STREET.timer = {};
      }

      // Store a reference to this component instance
      STREET.timer.component = this;

      // Provide API methods
      STREET.timer.play = this.play.bind(this);
      STREET.timer.pause = this.pause.bind(this);
      STREET.timer.stop = this.stop.bind(this);
      STREET.timer.getTime = this.getTime.bind(this);
      STREET.timer.getFormattedTime = this.getFormattedTime.bind(this);
      STREET.timer.isPlaying = () => this.isPlaying;
    }

    console.log('Scene timer initialized');
  },

  /**
   * Set up event listeners for controlling the timer
   */
  bindEvents: function () {
    // Use actual element to receive events
    const el = this.el;

    // Play event
    el.addEventListener('timer-play', this.play.bind(this));

    // Pause event
    el.addEventListener('timer-pause', this.pause.bind(this));

    // Stop event
    el.addEventListener('timer-stop', this.stop.bind(this));

    // Reset event
    el.addEventListener('timer-reset', this.reset.bind(this));

    // Set time event (e.g., for jumping to a specific time)
    el.addEventListener('timer-set-time', (event) => {
      if (event.detail && typeof event.detail.time === 'number') {
        this.setTime(event.detail.time);
      }
    });
  },

  /**
   * Start or resume the timer
   */
  play: function () {
    if (this.isPlaying) return;

    // We'll set the startTime on the next tick when we have a valid tick time
    // The tick method will initialize timing on the next frame

    // Set playing state
    this.isPlaying = true;

    console.log('Starting timer from', this.getFormattedTime());

    // Emit event
    this.el.emit('timer-started', { time: this.elapsedTime });
  },

  /**
   * Pause the timer
   */
  pause: function () {
    if (!this.isPlaying) return;

    // We don't need to update elapsedTime here as it's continuously updated in tick

    this.isPlaying = false;

    // Emit event
    this.el.emit('timer-paused', { time: this.elapsedTime });

    console.log('Scene timer paused at', this.getFormattedTime());
  },

  /**
   * Stop and reset the timer
   */
  stop: function () {
    this.isPlaying = false;

    // Emit event before resetting time
    this.el.emit('timer-stopped', { time: this.elapsedTime });

    // Reset timer state
    this.reset();

    console.log('Scene timer stopped and reset');
  },

  /**
   * Reset the timer to zero without changing play state
   */
  reset: function () {
    this.elapsedTime = 0;
    this.startTime = null; // Will be set on next tick if playing

    // Emit event
    this.el.emit('timer-reset', { time: 0 });

    console.log('Scene timer reset');
  },

  /**
   * Set the timer to a specific time
   * @param {number} time - Time in milliseconds
   */
  setTime: function (time) {
    this.elapsedTime = time;

    if (this.isPlaying && this.lastTickTime !== null) {
      // Calculate what the startTime should be based on the current tick time
      this.startTime = this.lastTickTime - time;
    }

    // Emit event
    this.el.emit('timer-time-set', { time: time });

    console.log('Scene timer set to', this.getFormattedTime());
  },

  /**
   * Get the current elapsed time in milliseconds
   * @returns {number} Elapsed time in milliseconds
   */
  getTime: function () {
    return this.elapsedTime;
  },

  /**
   * Get the current elapsed time in the specified format
   * @returns {string} Formatted time string
   */
  getFormattedTime: function () {
    return this.formatTime(this.elapsedTime, this.data.format);
  },

  /**
   * Format a time value according to the specified format
   * @param {number} milliseconds - Time in milliseconds
   * @param {string} format - Format string: 'mm:ss:ff', 'ss:ms', or 'raw'
   * @returns {string|number} Formatted time
   */
  formatTime: function (milliseconds, format) {
    if (format === 'raw') {
      return Math.floor(milliseconds); // instead we want to limit to integer
    }

    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (format === 'mm:ss:ff') {
      // Broadcast style: MM:SS:FF (frames)
      const frames = Math.floor(
        (milliseconds % 1000) / (1000 / this.frameRate)
      );
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    } else if (format === 'ss:ms') {
      // Stopwatch style: SS.ms
      const ms = Math.floor((milliseconds % 1000) / 10);
      return `${totalSeconds}.${ms.toString().padStart(2, '0')}`;
    } else {
      // Default to MM:SS
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  },

  update: function (oldData) {
    // Handle data changes if needed
    if (oldData && oldData.format !== this.data.format) {
      console.log('Scene timer format changed to', this.data.format);
    }
  },

  tick: function (time, deltaTime) {
    // Store the current tick time for reference in other methods
    this.lastTickTime = time;

    // Only update time if playing
    if (!this.isPlaying) return;

    // If this is the first tick after starting or resuming, initialize the start time
    if (this.startTime === null) {
      this.startTime = time - this.elapsedTime;
    }

    // Calculate elapsed time using A-Frame's tick time
    this.elapsedTime = time - this.startTime;
  },

  remove: function () {
    // Stop the timer and cleanup
    if (this.isPlaying) {
      this.stop();
    }

    // Remove all event listeners
    const el = this.el;
    el.removeEventListener('timer-play', this.play);
    el.removeEventListener('timer-pause', this.pause);
    el.removeEventListener('timer-stop', this.stop);
    el.removeEventListener('timer-reset', this.reset);
    el.removeEventListener('timer-set-time', this.setTime);

    // Remove from global STREET object if present
    if (typeof STREET !== 'undefined' && STREET.timer) {
      STREET.timer = null;
    }

    console.log('Scene timer removed');
  }
});
