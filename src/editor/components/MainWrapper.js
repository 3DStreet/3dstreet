import Main from './Main';
import ErrorBoundary from './ErrorBoundary';
import { useState, useCallback } from 'react';

const MainWrapper = (props) => {
  const [key, setKey] = useState(0);

  // This function will be passed to the ErrorBoundary to reset the application state
  const handleRecover = useCallback(() => {
    // Reset the key to force a re-render of the Main component
    setKey((prevKey) => prevKey + 1);

    // You can add additional recovery logic here if needed
    // For example, clearing specific state in your application
    console.log('Attempting to recover from error...');
  }, []);

  // This function will be called when an error is caught
  const handleError = useCallback((error, errorInfo) => {
    // Log the error to your preferred error tracking service
    console.error('Error caught in ErrorBoundary:', error);
    console.error('Component stack:', errorInfo?.componentStack);

    // You can add additional error handling logic here
    // For example, sending the error to a monitoring service
  }, []);

  return (
    <ErrorBoundary onRecover={handleRecover} onError={handleError}>
      <Main key={key} {...props} />
    </ErrorBoundary>
  );
};

export default MainWrapper;
