import styles from './GeoModal.module.scss';
import { Copy32Icon, Mangnifier20Icon } from '../../../icons';

import { useAuthContext } from '../../../contexts/index.js';
import Modal from '../Modal.jsx';
import { Button, Input } from '../../components/index.js';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { DownloadIcon } from '../../../icons/icons.jsx';
import GeoImg from '../../../../../ui_assets/geo.png';
import Events from '../../../lib/Events.js';

const GeoModal = ({ isOpen, onClose }) => {
  const { currentUser } = useAuthContext();

  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: 'AIzaSyCwldpJKOZ1yh_FT8NrUPuPeMedEy1R2jw'
  });

  const onSaveHandler = () => {
    if (!currentUser?.isPremium) {
      onClose();
      Events.emit('openpaymentmodel');
    }
  };

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
    >
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <img src={GeoImg} alt="geo" />
          <p>Scene Location</p>
          <p className={styles.badge}>Pro</p>
        </div>
        <Input
          leadingIcon={<Mangnifier20Icon />}
          placeholder="Search for a location"
        ></Input>
        {isLoaded && (
          <GoogleMap
            mapContainerStyle={{
              width: '100%',
              minHeight: '350px',
              borderRadius: 4,
              border: '1px solid #8965EF'
            }}
            center={{ lat: 0, lng: 0 }}
            zoom={1}
          />
        )}

        <div className={styles.sceneGeo}>
          <div>
            <p>Current Centerpoint</p>
            <Input
              leadingIcon={<p className={styles.iconGeo}>Lat, Long</p>}
              tailingIcon={<Copy32Icon className={styles.copyIcon} />}
              placeholder="None"
            ></Input>
          </div>
          <div>
            <p>New Centerpoint</p>
            <Input
              leadingIcon={<p className={styles.iconGeo}>Lat, Long</p>}
              tailingIcon={<Copy32Icon className={styles.copyIcon} />}
              placeholder="0, 0"
            ></Input>
          </div>
        </div>

        <div className={styles.controlButtons}>
          <Button variant={'ghost'}>Cancel</Button>
          <Button
            trailingicon={
              currentUser?.isPremium ? (
                <></>
              ) : (
                <span className={styles.locked}>🔒</span>
              )
            }
            leadingicon={<DownloadIcon />}
            variant={'filled'}
            onClick={onSaveHandler}
          >
            Update with 3D Map
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export { GeoModal };
