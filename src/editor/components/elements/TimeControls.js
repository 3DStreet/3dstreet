import PropTypes from 'prop-types';
import { useState, useEffect, useRef } from 'react';
import { Button } from '../elements';
import canvasRecorder from '../../lib/CanvasRecorder';
import Events from '../../lib/Events';
import useStore from '@/store';

/**
 * TimeControls component for the header during viewer mode.
 * Provides record, play, pause, stop buttons and a broadcast-style timer.
 * Uses the global scene-timer component for timing.
 */
const TimeControls = ({ entity }) => {
  // Get viewer mode status from the store
  const { isInspectorEnabled } = useStore();

  // Component states
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // Time in milliseconds
  const [viewerModeActive, setViewerModeActive] = useState(!isInspectorEnabled);
  const [timeFormat, setTimeFormat] = useState('mm:ss:ff'); // Track current time format

  // References
  const sceneTimerRef = useRef(null); // Reference to the scene-timer component

  // Initialize and clean up
  useEffect(() => {
    // Find the scene-timer component
    if (
      !sceneTimerRef.current &&
      typeof STREET !== 'undefined' &&
      STREET.timer
    ) {
      sceneTimerRef.current = STREET.timer;

      // Update state based on scene timer's current state
      setIsPlaying(STREET.timer.isPlaying());
    }

    // Set up event listeners for timer state changes (not for ticks)
    const handleTimerStarted = () => setIsPlaying(true);
    const handleTimerPaused = () => {
      setIsPlaying(false);
      setIsPaused(true);
    };
    const handleTimerStopped = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setElapsedTime(0);
    };

    // Listen for inspector state changes
    const handleInspectorStatus = (enabled) => {
      setViewerModeActive(!enabled);
      if (enabled) {
        // Inspector enabled (editing mode) - pause animation
        if (sceneTimerRef.current && isPlaying) {
          sceneTimerRef.current.pause();
        }

        // If recording, stop it
        if (isRecording) {
          handleStopRecording();
        }
      } else {
        // Inspector disabled (viewing mode) - animation will be controlled by play button
      }
    };

    // Add event listeners for state changes only
    const sceneEl = document.querySelector('a-scene');
    if (sceneEl) {
      sceneEl.addEventListener('timer-started', handleTimerStarted);
      sceneEl.addEventListener('timer-paused', handleTimerPaused);
      sceneEl.addEventListener('timer-stopped', handleTimerStopped);
    }

    Events.on('inspectorenabled', handleInspectorStatus);

    // Check recording status on component mount
    const recordingStatus = canvasRecorder.isCurrentlyRecording();
    if (recordingStatus !== isRecording) {
      setIsRecording(recordingStatus);
    }

    // Clean up event listeners
    return () => {
      Events.off('inspectorenabled', handleInspectorStatus);
      if (sceneEl) {
        sceneEl.removeEventListener('timer-started', handleTimerStarted);
        sceneEl.removeEventListener('timer-paused', handleTimerPaused);
        sceneEl.removeEventListener('timer-stopped', handleTimerStopped);
      }
    };
  }, [isRecording, isPlaying, viewerModeActive]);

  // Set up polling for timer updates
  useEffect(() => {
    // Only poll if the component is mounted and timer is available
    if (!sceneTimerRef.current || !viewerModeActive) return;

    // Create polling interval (10 times per second is sufficient for UI updates)
    const pollInterval = setInterval(() => {
      if (sceneTimerRef.current) {
        // Get time directly from the timer component
        const currentTime = sceneTimerRef.current.getTime();
        setElapsedTime(currentTime);

        // Also update playing state if it changed
        const isTimerPlaying = sceneTimerRef.current.isPlaying();
        if (isPlaying !== isTimerPlaying) {
          setIsPlaying(isTimerPlaying);
        }
      }
    }, 10); // 10 Hz polling rate

    // Clean up interval on unmount
    return () => clearInterval(pollInterval);
  }, [viewerModeActive, isPlaying]);

  // Format time based on current format setting
  const formatTime = (milliseconds) => {
    // Use the scene-timer's formatting if available
    if (sceneTimerRef.current && sceneTimerRef.current.getFormattedTime) {
      // The scene-timer's format is controlled by the timeFormat state
      return sceneTimerRef.current.getFormattedTime();
    }

    // Fallback formatting if scene-timer is not available
    if (timeFormat === 'raw') {
      return milliseconds.toFixed(0);
    } else {
      const totalSeconds = Math.floor(milliseconds / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const frames = Math.floor((milliseconds % 1000) / (1000 / 30)); // Assuming 30fps

      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    }
  };

  // Toggle time format when clicking on the time display
  const handleTimeFormatToggle = () => {
    const newFormat = timeFormat === 'mm:ss:ff' ? 'raw' : 'mm:ss:ff';
    setTimeFormat(newFormat);
    // Also update the scene-timer component format
    if (sceneTimerRef.current && sceneTimerRef.current.component.el) {
      sceneTimerRef.current.component.el.setAttribute(
        'scene-timer',
        'format',
        newFormat
      );
    }
  };

  // Handler for play button
  const handlePlay = () => {
    // Use the scene-timer to control playback
    if (sceneTimerRef.current) {
      sceneTimerRef.current.play();
    }

    // Emit an event to notify the viewer mode component to resume animation
    Events.emit('viewer-animation-play');

    setIsPaused(false);
    setIsPlaying(true);
  };

  // Handler for pause button
  const handlePause = () => {
    // Use the scene-timer to control playback
    if (sceneTimerRef.current) {
      sceneTimerRef.current.pause();
    }

    // Emit an event to notify the viewer mode component to pause animation
    Events.emit('viewer-animation-pause');

    setIsPaused(true);
    setIsPlaying(false);
  };

  // Handler for stop button
  const handleStop = () => {
    // Use the scene-timer to control playback
    if (sceneTimerRef.current) {
      sceneTimerRef.current.stop();
    }

    // If recording is in progress, stop it
    if (isRecording) {
      handleStopRecording();
    }

    // Emit an event to notify the viewer mode component to stop animation
    Events.emit('viewer-animation-stop');

    setIsPaused(false);
    setIsPlaying(false);
    setElapsedTime(0);
  };

  // Handler for record button
  const handleStartRecording = async () => {
    // Find the A-Frame canvas
    const aframeCanvas = document.querySelector('a-scene').canvas;
    if (!aframeCanvas) {
      console.error('Could not find A-Frame canvas for recording');
      return;
    }

    // Start recording the canvas
    const success = await canvasRecorder.startRecording(aframeCanvas, {
      name: '3DStreet-Recording-' + new Date().toISOString().slice(0, 10)
    });

    if (success) {
      setIsRecording(true);

      // Make sure we're playing if not already
      if (!isPlaying) {
        handlePlay();
      }
    }
  };

  // Handler for stop recording button
  const handleStopRecording = async () => {
    if (canvasRecorder.isCurrentlyRecording()) {
      try {
        console.log('Stopping recording...');
        await canvasRecorder.stopRecording();
        setIsRecording(false);
      } catch (error) {
        console.error('Error stopping recording:', error);
      }
    }
  };

  // If we're not in viewer mode, don't render the controls
  if (isInspectorEnabled || !viewerModeActive) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2 rounded-md bg-gray-800 bg-opacity-75 p-2">
      {/* Timer display - clickable to toggle format */}
      <div
        className="flex cursor-pointer items-center rounded-md bg-black px-3 py-1 font-mono text-white"
        onClick={handleTimeFormatToggle}
        title="Click to toggle time format"
      >
        <span>{formatTime(elapsedTime)}</span>
        {isRecording && (
          <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
        )}
      </div>

      {/* Playback controls */}
      <div className="flex space-x-1">
        {!isPlaying ? (
          <Button
            variant="toolbtn"
            onClick={handlePlay}
            aria-label="Play"
            title="Play animation"
            className="p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </Button>
        ) : (
          <Button
            variant="toolbtn"
            onClick={handlePause}
            aria-label="Pause"
            title="Pause animation"
            className="p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </Button>
        )}

        <Button
          variant="toolbtn"
          onClick={handleStop}
          aria-label="Stop"
          title="Stop and reset animation"
          className="p-1"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M6 6h12v12H6z" />
          </svg>
        </Button>

        {!isRecording ? (
          <Button
            variant="toolbtn"
            onClick={handleStartRecording}
            aria-label="Record"
            title="Start recording (will download MP4 when stopped)"
            className="p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="text-red-500"
            >
              <circle cx="12" cy="12" r="8" />
            </svg>
          </Button>
        ) : (
          <Button
            variant="toolbtn"
            onClick={handleStopRecording}
            aria-label="Stop Recording"
            title="Stop recording and save MP4"
            className="p-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="animate-pulse text-red-500"
            >
              <rect x="6" y="6" width="12" height="12" />
            </svg>
          </Button>
        )}
      </div>
    </div>
  );
};

TimeControls.propTypes = {
  entity: PropTypes.object
};

export default TimeControls;
