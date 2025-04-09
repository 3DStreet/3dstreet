import React, { Component } from 'react';
import PropTypes from 'prop-types';

/**
 * ErrorBoundary component for 3DStreet that catches React errors while allowing
 * the underlying A-Frame/Three.js canvas to continue running.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isDetailsExpanded: false
    };
    this.copyErrorDetailsRef = React.createRef();
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to the console
    console.error('Error caught by ErrorBoundary:', error, errorInfo);

    // Update state with error details
    this.setState({ errorInfo });

    // Call the onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  toggleDetails = () => {
    this.setState((prevState) => ({
      isDetailsExpanded: !prevState.isDetailsExpanded
    }));
  };

  copyErrorDetails = () => {
    const { error, errorInfo } = this.state;
    const errorDetails = `
Error: ${error?.toString() || 'Unknown error'}

Component Stack:
${errorInfo?.componentStack || 'No component stack available'}

URL: ${window.location.href}
User Agent: ${navigator.userAgent}
Date/Time: ${new Date().toISOString()}
    `.trim();

    try {
      navigator.clipboard.writeText(errorDetails).then(
        () => {
          // Show a temporary success message
          const copyButton = this.copyErrorDetailsRef.current;
          if (copyButton) {
            const originalText = copyButton.textContent;
            copyButton.textContent = 'Copied!';
            setTimeout(() => {
              copyButton.textContent = originalText;
            }, 2000);
          }
        },
        (err) => {
          console.error('Failed to copy error details:', err);
        }
      );
    } catch (err) {
      console.error('Copy to clipboard not supported:', err);

      // Fallback for browsers that don't support clipboard API
      const textarea = document.createElement('textarea');
      textarea.value = errorDetails;
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        document.execCommand('copy');
        const copyButton = this.copyErrorDetailsRef.current;
        if (copyButton) {
          const originalText = copyButton.textContent;
          copyButton.textContent = 'Copied!';
          setTimeout(() => {
            copyButton.textContent = originalText;
          }, 2000);
        }
      } catch (e) {
        console.error('Fallback copy failed:', e);
      }

      document.body.removeChild(textarea);
    }
  };

  handleRecovery = () => {
    // Reset the error state
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      isDetailsExpanded: false
    });

    // Call the onRecover callback if provided
    if (this.props.onRecover) {
      this.props.onRecover();
    }
  };

  render() {
    const { hasError, error, errorInfo, isDetailsExpanded } = this.state;
    const { children, fallback } = this.props;

    if (!hasError) {
      return children;
    }

    // If a custom fallback is provided, use it
    if (fallback) {
      return fallback(error, errorInfo, this.handleRecovery);
    }

    // Default error UI
    return (
      <div className="error-boundary-overlay">
        <div className="error-boundary-container">
          <div className="error-boundary-header">
            <h2>Something went wrong</h2>
            <p>
              3DStreet Editor encountered an error, but the 3D view is still
              running.
            </p>
          </div>

          <div className="error-boundary-message">
            <p>{error?.toString() || 'An unexpected error occurred'}</p>
          </div>

          <div className="error-boundary-details">
            <button
              className="error-boundary-toggle-details"
              onClick={this.toggleDetails}
            >
              {isDetailsExpanded ? 'Hide Details' : 'Show Details'}
            </button>

            {isDetailsExpanded && (
              <div className="error-boundary-stack">
                <pre>
                  {errorInfo?.componentStack || 'No stack trace available'}
                </pre>
              </div>
            )}
          </div>

          <div className="error-boundary-actions">
            <button
              className="error-boundary-copy-button"
              onClick={this.copyErrorDetails}
              ref={this.copyErrorDetailsRef}
            >
              Copy Error Details
            </button>

            <button
              className="error-boundary-recover-button"
              onClick={this.handleRecovery}
            >
              Try to Recover
            </button>
          </div>
        </div>
      </div>
    );
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  onError: PropTypes.func,
  onRecover: PropTypes.func,
  fallback: PropTypes.func
};

export default ErrorBoundary;
