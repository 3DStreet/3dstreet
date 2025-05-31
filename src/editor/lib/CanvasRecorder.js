/* global AFRAME */

// Recorder statuses - simple enum replacement
const RecorderStatus = {
  Idle: 0,
  Recording: 1,
  Stopped: 2,
  Error: 3
};

class CanvasRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.stream = null;
    this.status = RecorderStatus.Idle;
    this.isRecording = false;
    this.captureInterval = null;
    this.frameCount = 0;
  }

  /**
   * Start recording the canvas
   * @param {HTMLCanvasElement} canvas - The canvas element to record
   * @param {Object} options - Recording options
   */
  async startRecording(canvas, options = {}) {
    if (this.isRecording) return false;

    try {
      // Store configuration - get the A-Frame canvas directly
      const aframeScene = AFRAME.scenes[0];
      this.canvas = aframeScene.canvas || canvas;

      if (!this.canvas) {
        console.error('No valid canvas found for recording');
        return false;
      }

      console.log(
        `Found A-Frame canvas for recording: ${this.canvas.width}x${this.canvas.height}`
      );

      this.recordingName =
        options.name ||
        '3DStreet-Recording-' + new Date().toISOString().slice(0, 10);
      this.frameRate = options.frameRate || 30;
      this.maxDuration = options.duration || 300; // 5 minutes max by default
      this.recordedChunks = [];

      // Check for MediaRecorder support
      if (!('MediaRecorder' in window)) {
        console.error('MediaRecorder API is not supported in this browser');
        return false;
      }

      // Determine which format is supported
      let mimeType = '';
      const possibleTypes = [
        'video/mp4;codecs=avc1.42E01E', // H.264 in MP4
        'video/mp4',
        'video/webm;codecs=h264',
        'video/webm;codecs=vp9',
        'video/webm'
      ];

      for (const type of possibleTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }

      // Store the MIME type in the instance for later use
      this.videoMimeType = mimeType;

      console.log(`Using MIME type: ${mimeType}`);

      // Get a media stream directly from the A-Frame canvas
      // Setting a higher fps value ensures smoother video
      this.stream = this.canvas.captureStream(this.frameRate);

      // Create a MediaRecorder with good quality
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: this.videoMimeType,
        videoBitsPerSecond: 8000000 // 8 Mbps for better quality
      });

      // Collect the recorded data
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      // Handle recording stop
      this.mediaRecorder.onstop = () => {
        // Download recording but with a slight delay to ensure all data is collected
        setTimeout(() => this.downloadRecording(), 100);
      };

      // Set up a simple interval just to track frame count for logging
      this.captureInterval = setInterval(() => {
        if (this.isRecording && this.status === RecorderStatus.Recording) {
          this.frameCount++;
        }
      }, 1000 / this.frameRate);

      // Start the MediaRecorder
      this.mediaRecorder.start(1000); // Request data every second

      // Set recording state
      this.isRecording = true;
      this.status = RecorderStatus.Recording;
      this.startTime = Date.now();

      // Set a timeout for max duration
      this.durationTimeout = setTimeout(() => {
        if (this.isRecording) {
          console.log(
            `Maximum recording duration (${this.maxDuration}s) reached, stopping recording`
          );
          this.stopRecording();
        }
      }, this.maxDuration * 1000);

      console.log('Recording started with MediaRecorder');
      return true;
    } catch (error) {
      console.error('Error starting recording:', error);
      this.status = RecorderStatus.Error;
      return false;
    }
  }

  /**
   * Download the recorded video
   * @private
   */
  downloadRecording() {
    try {
      if (!this.recordedChunks.length) {
        console.warn('No recorded chunks available to download');
        return;
      }

      console.log(
        `Creating video file from ${this.recordedChunks.length} chunks`
      );

      // Determine the file extension based on the stored MIME type
      // Use the stored MIME type rather than trying to access mediaRecorder which might be null
      const mimeType = this.videoMimeType?.toLowerCase() || '';
      let fileExtension = 'mp4';
      let blobType = 'video/mp4';

      if (mimeType.includes('webm')) {
        fileExtension = 'webm';
        blobType = 'video/webm';
      }

      console.log(
        `Using MIME type for download: ${mimeType}, extension: ${fileExtension}`
      );

      // Create a blob from all the chunks
      const blob = new Blob(this.recordedChunks, { type: blobType });

      // Create a download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.recordingName}.${fileExtension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Clean up
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      console.log(
        `Recording saved as ${this.recordingName}.${fileExtension} (${(blob.size / (1024 * 1024)).toFixed(2)} MB)`
      );
    } catch (error) {
      console.error('Error downloading recording:', error);
    }
  }

  /**
   * Stop the recording
   */
  async stopRecording() {
    if (!this.isRecording) return;

    // Update status
    this.status = RecorderStatus.Stopped;
    this.isRecording = false;

    // Store reference to mediaRecorder before we potentially clear it
    const mediaRecorder = this.mediaRecorder;

    // Clear timeout
    if (this.durationTimeout) {
      clearTimeout(this.durationTimeout);
      this.durationTimeout = null;
    }

    // Clear capture interval
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    try {
      // Only stop if mediaRecorder exists and is not already stopped
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        // Request data one last time
        mediaRecorder.requestData();

        // Stop the MediaRecorder (this will trigger the onstop event)
        mediaRecorder.stop();

        // Recording duration
        const duration = (Date.now() - this.startTime) / 1000;
        console.log(`Recording stopped after ${duration.toFixed(1)} seconds`);
      } else {
        // If no valid mediaRecorder, just try to download what we have
        setTimeout(() => this.downloadRecording(), 100);
      }
    } catch (error) {
      console.error('Error stopping MediaRecorder:', error);
      // If error, try to download any chunks we have
      this.downloadRecording();
    } finally {
      // Cleanup
      if (this.stream) {
        // Stop all tracks
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }

      // No writer, processor, or generator to clean up in the simplified approach
      // This code is removed as it's no longer needed

      this.mediaRecorder = null;
      this.canvas = null;
      this.frameCount = 0;
      this.status = RecorderStatus.Idle;

      // No offscreen canvas to clean up
    }
  }

  /**
   * Manually generate a video file from individual frames (not used with MediaRecorder)
   * This is a fallback method when MediaRecorder doesn't work
   */
  generateVideoManually() {
    // Not needed with MediaRecorder approach
    console.warn('Manual video generation not needed with MediaRecorder');
    return null;
  }

  /**
   * Check if recording is in progress
   */
  isCurrentlyRecording() {
    return this.isRecording;
  }

  /**
   * Check if browser supports WebCodecs
   */
  static isSupported() {
    return typeof window !== 'undefined' && 'VideoEncoder' in window;
  }
}

// Create a singleton instance
const canvasRecorderInstance = new CanvasRecorder();
export default canvasRecorderInstance;
