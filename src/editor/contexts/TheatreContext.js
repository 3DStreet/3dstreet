import { createContext, useEffect } from 'react';
import { getProject } from '@theatre/core';
import studio from '@theatre/studio';

export const TheatreContext = createContext();

export function TheatreProvider({ children }) {
  useEffect(() => {
    // Initialize Theatre.js
    studio.initialize();

    // Create a project
    const project = getProject('3DStreet Animation');
    const sheet = project.sheet('Main Sheet');
    console.log('[theatre] project', project);
    console.log('[theatre] sheet', sheet);

    return () => {
      // Cleanup if needed
    };
  }, []);

  return (
    <TheatreContext.Provider value={{}}>{children}</TheatreContext.Provider>
  );
}
