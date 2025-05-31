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
    this.startTime = null;
    this.timerActive = false;
    this.isPaused = false;
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
      STREET.timer.startTimer = this.startTimer.bind(this);
      STREET.timer.pauseTimer = this.pauseTimer.bind(this);
      STREET.timer.stopTimer = this.stopTimer.bind(this);
      STREET.timer.getTime = this.getTime.bind(this);
      STREET.timer.getFormattedTime = this.getFormattedTime.bind(this);
      STREET.timer.isTimerActive = () => this.timerActive;
    }

    console.log('Scene timer initialized');
  },

  /**
   * Set up event listeners for controlling the timer
   */
  bindEvents: function () {
    // Use actual element to receive events
    const el = this.el;

    // Timer control events
    el.addEventListener('timer-start', this.startTimer.bind(this));
    el.addEventListener('timer-pause', this.pauseTimer.bind(this));
    el.addEventListener('timer-stop', this.stopTimer.bind(this));

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
  startTimer: function () {
    if (this.timerActive) return;

    // If we're resuming from a pause
    if (this.isPaused) {
      // Store the current elapsed time when resuming from pause
      const pausedElapsedTime = this.elapsedTime;

      // Adjust the start time to account for the time spent paused
      this.startTime = performance.now() - pausedElapsedTime;

      console.log('Resuming timer from pause at', this.getFormattedTime());
    } else {
      // If starting fresh (not from a pause)
      this.startTime = performance.now() - this.elapsedTime;
      console.log('Starting timer from', this.getFormattedTime());
    }

    // Make sure we're playing
    this.timerActive = true;
    this.isPaused = false;

    // Emit event
    this.el.emit('timer-started', { time: this.elapsedTime });
  },

  /**
   * Pause the timer
   */
  pauseTimer: function () {
    if (!this.timerActive) return;

    // Before pausing, update the elapsed time to the current value
    // This freezes the time at the exact moment of pause
    if (this.startTime !== null) {
      this.elapsedTime = performance.now() - this.startTime;
    }

    this.timerActive = false;
    this.isPaused = true;

    // Emit event
    this.el.emit('timer-paused', { time: this.elapsedTime });

    console.log('Scene timer paused at', this.getFormattedTime());
  },

  /**
   * Stop and reset the timer
   */
  stopTimer: function () {
    this.timerActive = false;
    this.isPaused = false;

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
    this.startTime = this.timerActive ? performance.now() : null;

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

    if (this.timerActive) {
      this.startTime = performance.now() - time;
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
      // Pad with zeros to ensure it's at least 8 digits long
      return Math.floor(milliseconds).toString().padStart(8, '0');
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
    // Only update time if playing
    if (!this.timerActive) return;

    // Calculate elapsed time
    const now = performance.now();
    this.elapsedTime = now - this.startTime;

    // Timer-tick events are disabled for performance reasons
    // Components that need time updates should poll getTime() or getFormattedTime() instead
  },

  /**
   * Cleanup when component is removed
   */
  remove: function () {
    // Stop the timer and cleanup
    if (this.timerActive) {
      this.stopTimer();
    }

    // Remove all event listeners
    const el = this.el;
    el.removeEventListener('timer-play', this.startTimer);
    el.removeEventListener('timer-pause', this.pauseTimer);
    el.removeEventListener('timer-stop', this.stopTimer);
    el.removeEventListener('timer-reset', this.reset);
    el.removeEventListener('timer-set-time', this.setTime);

    // Remove from global STREET object if present
    if (typeof STREET !== 'undefined' && STREET.timer) {
      STREET.timer = null;
    }

    console.log('Scene timer removed');
  }
});
