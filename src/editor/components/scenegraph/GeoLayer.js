import { useState, useEffect, useRef } from 'react';
import useStore from '@/store';
import { useAuthContext, useGeoContext } from '@/editor/contexts/index.js';
import Events from '@/editor/lib/Events';
import posthog from 'posthog-js';
import { GeospatialIcon } from '../../icons';

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
  const streetGeo = useGeoContext();
  const entity = document.getElementById('reference-layers');

  const onClick = () => {
    setClicked(true);
    posthog.capture('geo_layer_clicked');
    if (!currentUser) {
      setModal('signin');
    } else {
      if (streetGeo) {
        Events.emit('entityselect', entity);
      } else {
        setModal('geo');
      }
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
      className={`layersBlock py-2 pl-4 ${clicked ? 'bg-violet-600' : 'hover:bg-violet-600 hover:shadow-lg'} cursor-pointer`}
    >
      {visibilityButton}
      <div
        onClick={onClick}
        style={{ transform: 'scale(0.7)', marginLeft: '2px' }}
      >
        <GeospatialIcon />
      </div>
      <span
        onClick={onClick}
        className="entityName flex-1"
        style={{ marginLeft: '-2px' }}
      >
        Geospatial
        {!streetGeo && <span className="badge badgeAlert">Set Location</span>}
      </span>
    </div>
  );
};

export default GeoLayer;
