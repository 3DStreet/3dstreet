/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports) {

	if (typeof AFRAME === 'undefined') {
	    throw new Error('Component attempted to register before AFRAME was available.');
	}

	/**
	 * Alongpath component for A-Frame.
	 * Move Entities along a predefined Curve
	 */
	AFRAME.registerComponent('alongpath', {

	    //dependencies: ['curve'],

	    schema: {
	        curve: {default: ''},
	        triggers: {default: 'a-curve-point'},
	        triggerRadius: {type: 'number', default: 0.01},
	        dur: {default: 1000},
	        delay: {default: 0},
	        loop: {default: false},
	        rotate: {default: false},
	        resetonplay: {default:true}
	    },

	    init: function () {

	        // We have to fetch curve and triggers manually because of an A-FRAME ISSUE
	        // with Property-Type "Selector" / "SelectorAll": https://github.com/aframevr/aframe/issues/2517

	    },

	    update: function (oldData) {

	        this.curve = document.querySelector(this.data.curve);
	        this.triggers = this.curve.querySelectorAll(this.data.triggers);

	        if (!this.curve) {
	            console.warn("Curve not found. Can't follow anything...");
	        } else {
	            this.initialPosition = this.el.object3D.position;
	        }

	        this.reset();
	    },

	    reset: function() {
	        // Reset to initial state
	        this.interval = 0;

	        this.el.removeState("endofpath");
	        this.el.removeState("moveonpath");

	        if (this.activeTrigger) {
	            this.activeTrigger.removeState("alongpath-active-trigger");
	            this.activeTrigger = null;
	        }
	    },

	    getI_: function (interval, delay, dur) {
	      var i = 0;

	      if (interval - delay >= dur) {
	        // Time is up, we should be at the end of the path
	        i = 1;
	      } else if ((interval - delay < 0)) {
	        // We are still waiting for the delay-time to finish
	        // so keep entity at the beginning of the path
	        i = 0;
	      } else {
	        // Update path position based on timing
	        i = (interval - delay) / dur;
	      }

	      return i
	    },

	    tick: function (time, timeDelta) {
	        var curve = this.curve.components['curve'] ? this.curve.components['curve'].curve : null;

	        if (curve) {
	            // Only update position if we didn't reach
	            // the end of the path
	            if (!this.el.is("endofpath")) {
	                this.interval = this.interval + timeDelta;

	                var i = this.getI_(this.interval, this.data.delay, this.data.dur)

	                if ((this.data.loop === false) && i >= 1) {
	                    // Set the end-position
	                    this.el.setAttribute('position', curve.points[curve.points.length - 1]);

	                    // We have reached the end of the path and are not going
	                    // to loop back to the beginning therefore set final state
	                    this.el.removeState("moveonpath");
	                    this.el.addState("endofpath");
	                    this.el.emit("movingended");
	                } else if ((this.data.loop === true) && i >= 1) {
	                    // We have reached the end of the path
	                    // but we are looping through the curve,
	                    // so restart here.
	                    this.el.removeState("moveonpath");
	                    this.el.emit("movingended");
	                    this.interval = this.data.delay;
	                } else {
	                    // We are starting to move or somewhere in the middle of the path…
	                    if (!this.el.is("moveonpath")) {
	                        this.el.addState("moveonpath");
	                        this.el.emit("movingstarted");
	                    }

	                    // …updating position
	                    var p = curve.getPoint(i);
	                    this.el.setAttribute('position', p);
	                }

	                // Update Rotation of Entity
	                if (this.data.rotate === true) {

	                    var nextInterval = this.interval + timeDelta
	                    var nextPosition = curve.getPoint(this.getI_(nextInterval, this.data.delay, this.data.dur));

	                    this.el.object3D.lookAt(nextPosition)

	                }

	                // Check for Active-Triggers
	                if (this.triggers && (this.triggers.length > 0)) {
	                    this.updateActiveTrigger();
	                }
	            }
	        } else {
	            console.error("The entity associated with the curve property has no curve component.");
	        }
	    },

	    play: function () {
	        if (this.data.resetonplay) {
	            this.reset();
	        }
	    },

	    remove: function () {
	        this.el.object3D.position.copy(this.initialPosition);
	    },

	    updateActiveTrigger: function() {
	        for (var i = 0; i < this.triggers.length; i++) {
	            if (this.triggers[i].object3D) {
	                if (this.triggers[i].object3D.position.distanceTo(this.el.object3D.position) <= this.data.triggerRadius) {
	                    // If this element is not the active trigger, activate it - and if necessary deactivate other triggers.
	                    if (this.activeTrigger && (this.activeTrigger != this.triggers[i])) {
	                        this.activeTrigger.removeState("alongpath-active-trigger");
	                        this.activeTrigger.emit("alongpath-trigger-deactivated");

	                        this.activeTrigger = this.triggers[i];
	                        this.activeTrigger.addState("alongpath-active-trigger");
	                        this.activeTrigger.emit("alongpath-trigger-activated");
	                    } else if (!this.activeTrigger) {
	                        this.activeTrigger = this.triggers[i];
	                        this.activeTrigger.addState("alongpath-active-trigger");
	                        this.activeTrigger.emit("alongpath-trigger-activated");
	                    }

	                    break;
	                } else {
	                    // If this Element was the active trigger, deactivate it
	                    if (this.activeTrigger && (this.activeTrigger == this.triggers[i])) {
	                        this.activeTrigger.removeState("alongpath-active-trigger");
	                        this.activeTrigger.emit("alongpath-trigger-deactivated");
	                        this.activeTrigger = null;
	                    }
	                }
	            }
	        }
	    }

	});


/***/ })
/******/ ]);