import { createContext, useContext, useEffect, useState } from 'react';

const GeoContext = createContext(null);

export const GeoProvider = ({ children }) => {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    const listener = (event) => {
      const streetGeo = event.detail;
      if (streetGeo && streetGeo['latitude'] && streetGeo['longitude']) {
        setInfo({
          latitude: streetGeo['latitude'],
          longitude: streetGeo['longitude'],
          elevation: streetGeo['elevation'] || 0
        });
      } else {
        setInfo(null);
      }
    };

    const listenerNewScene = () => {
      const streetGeo = document
        .getElementById('reference-layers')
        ?.getAttribute('street-geo');
      listener({ detail: streetGeo });
    };

    AFRAME.scenes[0].addEventListener('newGeo', listener);
    AFRAME.scenes[0].addEventListener('newScene', listenerNewScene);

    return () => {
      AFRAME.scenes[0].removeEventListener('newGeo', listener);
      AFRAME.scenes[0].removeEventListener('newScene', listenerNewScene);
    };
  }, []);

  return <GeoContext.Provider value={info}>{children}</GeoContext.Provider>;
};

export const useGeoContext = () => useContext(GeoContext);
