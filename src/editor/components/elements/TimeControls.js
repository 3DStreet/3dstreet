import { useState, useEffect, useRef } from 'react';
import { Button } from '../elements';
import canvasRecorder from '../../lib/CanvasRecorder';
import useStore from '@/store';
import { useAuthContext } from '../../contexts/Auth.context';

/**
 * TimeControls component for the header during viewer mode.
 * Provides record, play, pause, stop buttons and a broadcast-style timer.
 * Uses the global scene-timer component for timing.
 */
const TimeControls = () => {
  // Get viewer mode status from the store
  const { isInspectorEnabled } = useStore();
  // Get current user info to check pro status
  const { currentUser } = useAuthContext();

  // Component states
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewerModeActive] = useState(!isInspectorEnabled);
  const [timeFormat, setTimeFormat] = useState('mm:ss:ff'); // Track current time format
  const [, setTimeUpdate] = useState(0); // State to trigger re-renders on time updates

  // References
  const sceneTimerRef = useRef(null); // Reference to the scene-timer component

  // Initialize timer and set up event listeners
  useEffect(() => {
    // Find the scene-timer component
    if (typeof STREET !== 'undefined' && STREET.timer) {
      sceneTimerRef.current = STREET.timer;
      setIsPlaying(STREET.timer.isTimerActive());
    }

    // Set up event listeners for timer state changes
    const handleTimerStarted = () => setIsPlaying(true);
    const handleTimerPaused = () => setIsPlaying(false);
    const handleTimerStopped = () => setIsPlaying(false);

    // Add event listeners
    if (sceneTimerRef.current) {
      sceneTimerRef.current.component.el.addEventListener(
        'timer-started',
        handleTimerStarted
      );
      sceneTimerRef.current.component.el.addEventListener(
        'timer-paused',
        handleTimerPaused
      );
      sceneTimerRef.current.component.el.addEventListener(
        'timer-stopped',
        handleTimerStopped
      );
    }

    // Check recording status on component mount
    setIsRecording(canvasRecorder.isCurrentlyRecording());

    // Clean up event listeners
    return () => {
      if (sceneTimerRef.current) {
        sceneTimerRef.current.component.el.removeEventListener(
          'timer-started',
          handleTimerStarted
        );
        sceneTimerRef.current.component.el.removeEventListener(
          'timer-paused',
          handleTimerPaused
        );
        sceneTimerRef.current.component.el.removeEventListener(
          'timer-stopped',
          handleTimerStopped
        );
      }
    };
  }, [isPlaying, isRecording]);

  // Set up polling for timer updates
  useEffect(() => {
    // Only poll if the component is mounted and timer is available and we're in viewer mode
    if (!sceneTimerRef.current || !viewerModeActive) return;

    // Create polling interval (10 times per second is sufficient for UI updates)
    const pollInterval = setInterval(() => {
      if (sceneTimerRef.current) {
        // Force re-render to update the time display
        setTimeUpdate((prev) => prev + 1);

        // Update playing state if it changed
        const isTimerPlaying = sceneTimerRef.current.isTimerActive();
        if (isPlaying !== isTimerPlaying) {
          setIsPlaying(isTimerPlaying);
        }
      }
    }, 20);

    // Clean up interval on unmount
    return () => clearInterval(pollInterval);
  }, [viewerModeActive, isPlaying]);

  // Format time based on current format setting
  const formatTime = () => {
    // Use the scene-timer's formatting if available
    if (sceneTimerRef.current?.getFormattedTime) {
      return sceneTimerRef.current.getFormattedTime();
    }
    return '00:00:00';
  };

  // Toggle time format when clicking on the time display
  const handleTimeFormatToggle = () => {
    const newFormat = timeFormat === 'mm:ss:ff' ? 'raw' : 'mm:ss:ff';
    setTimeFormat(newFormat);
    // Update the scene-timer component format via event
    if (sceneTimerRef.current) {
      sceneTimerRef.current.component.el.emit('timer-set-time', {
        format: newFormat
      });
    }
  };

  // Handler for play button
  const handlePlay = () => {
    if (sceneTimerRef.current) {
      sceneTimerRef.current.component.el.emit('timer-start');
    }
    // UI state will be updated via the timer-started event we're listening for
  };

  // Handler for pause button
  const handlePause = () => {
    if (sceneTimerRef.current) {
      sceneTimerRef.current.component.el.emit('timer-pause');
    }
    // UI state will be updated via the timer-paused event we're listening for
  };

  // Handler for stop button
  const handleStop = () => {
    if (sceneTimerRef.current) {
      sceneTimerRef.current.component.el.emit('timer-stop');
    }

    if (isRecording) {
      handleStopRecording();
    }

    setIsPlaying(false);
  };

  // Handler for record button
  const handleStartRecording = async () => {
    // Check if user has pro account
    if (!currentUser?.isPro) {
      console.log('Recording requires a pro account');
      return;
    }

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

  // Check if we're not in viewer mode
  if (isInspectorEnabled || !viewerModeActive) {
    return null;
  }

  // Check if the viewer-mode component has preset="locomotion"
  const viewerModeEl = document.querySelector('[viewer-mode]');
  if (
    viewerModeEl &&
    viewerModeEl.getAttribute('viewer-mode').preset === 'locomotion'
  ) {
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
        <span>{formatTime()}</span>
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

        {/* Only show Record button if user has Pro account */}
        {!isRecording && currentUser?.isPro ? (
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
          isRecording && (
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
          )
        )}
      </div>
    </div>
  );
};

export default TimeControls;
