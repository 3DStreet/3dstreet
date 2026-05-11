/* global AFRAME */

/**
 * play-mode
 * =========
 *
 * Lightweight lifecycle system for "the user pressed Play."
 *
 * Play mode is intentionally decoupled from any single feature (drive
 * mode, traffic animation, future first-person walk, etc.). This
 * system owns one boolean and two events:
 *
 *   sceneEl.systems['play-mode'].start()  -> emits 'play-mode-start'
 *   sceneEl.systems['play-mode'].stop()   -> emits 'play-mode-stop'
 *
 * Features that want to do something during play register a listener
 * on the scene for those events and do their own setup/teardown. The
 * Play and Stop buttons in the editor toolbar just call start()/stop()
 * — they don't know what features will respond.
 *
 * The current isPlaying boolean is also mirrored into the zustand
 * store so React components can render off it without listening to
 * scene events directly.
 */
import useStore from '../store.js';

AFRAME.registerSystem('play-mode', {
  init: function () {
    this.isPlaying = false;
  },

  start: function () {
    if (this.isPlaying) return;
    this.isPlaying = true;
    useStore.setState({ isPlaying: true });
    this.sceneEl.emit('play-mode-start', {}, false);
  },

  stop: function () {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    useStore.setState({ isPlaying: false });
    this.sceneEl.emit('play-mode-stop', {}, false);
  }
});
