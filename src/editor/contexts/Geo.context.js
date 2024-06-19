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
    AFRAME.scenes[0].addEventListener('newGeo', listener);

    return () => AFRAME.scenes[0].removeEventListener('newGeo', listener);
  }, []);

  return <GeoContext.Provider value={info}>{children}</GeoContext.Provider>;
};

export const useGeoContext = () => useContext(GeoContext);
