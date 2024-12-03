import { useState, useEffect, useRef } from 'react';
import useStore from '@/store';
import { useAuthContext, useGeoContext } from '@/editor/contexts/index.js';
import Events from '@/editor/lib/Events';
import posthog from 'posthog-js';

const GeoLayer = () => {
  const [clicked, setClicked] = useState(false);
  const componentRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        componentRef.current &&
        !componentRef.current.contains(event.target) &&
        !event.target.closest('#rightPanel')
      ) {
        setClicked(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);
  const { currentUser } = useAuthContext();
  const setModal = useStore((state) => state.setModal);
  const startCheckout = useStore((state) => state.startCheckout);
  const streetGeo = useGeoContext();
  const entity = document.getElementById('reference-layers');

  const onClick = () => {
    setClicked(true);
    posthog.capture('geo_layer_clicked');
    if (!currentUser) {
      setModal('signin');
    } else if (currentUser.isPro) {
      if (streetGeo) {
        Events.emit('entityselect', entity);
      } else {
        setModal('geo');
      }
    } else {
      startCheckout('geo');
    }
  };

  const toggleVisibility = (entity) => {
    const visible =
      entity.tagName.toLowerCase() === 'a-scene'
        ? entity.object3D.visible
        : entity.getAttribute('visible');
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'visible',
      value: !visible
    });
  };

  const tagName = entity.tagName.toLowerCase();

  const visible =
    tagName === 'a-scene'
      ? entity.object3D.visible
      : entity.getAttribute('visible');
  const visibilityButton = (
    <i
      title="Toggle entity visibility"
      className={'fa ' + (visible ? 'fa-eye' : 'fa-eye-slash')}
      onClick={() => toggleVisibility(entity)}
    />
  );

  return (
    <div
      ref={componentRef}
      className={`layersBlock border py-2 pl-4 ${clicked ? 'bg-violet-800' : 'bg-violet-600 hover:bg-violet-700 hover:shadow-lg'} cursor-pointer`}
    >
      {visibilityButton}
      <span onClick={onClick} className="flex-1">
        {!streetGeo ? (
          <>
            <span> Set Location 🌎</span>
          </>
        ) : (
          <span>Geospatial Layer 🌎</span>
        )}
      </span>
    </div>
  );
};

export default GeoLayer;
