import Modal from '../Modal.jsx';
import useStore from '@/store.js';
import styles from './NewModal.module.scss';
import ScenePlaceholder from '@/../ui_assets/ScenePlaceholder.svg';
import { fileJSON, inputStreetmix } from '@/editor/lib/SceneUtils.js';

export const NewModal = () => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'new');

  const onClose = () => {
    setModal(null);
  };

  const onClickNew = () => {
    setModal(null);
    AFRAME.INSPECTOR.selectEntity(null);
    useStore.getState().newScene();
    STREET.utils.newScene();
    AFRAME.scenes[0].emit('newScene');
  };

  const scenesData = [
    {
      title: 'Create Blank Scene',
      imagePath: ScenePlaceholder,
      onClick: onClickNew
    },
    {
      title: 'Import From Streetmix',
      imagePath: ScenePlaceholder,
      onClick: inputStreetmix
    },
    {
      title: 'Import From JSON',
      imagePath: ScenePlaceholder,
      onClick: fileJSON
    }
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Scene">
      <div className={styles.wrapper}>
        {scenesData?.map((scene, index) => (
          <div key={index} className={styles.card} title={scene.title}>
            <div
              className={styles.img}
              onClick={() => {
                scene.onClick();
                onClose();
              }}
              style={{
                backgroundImage: `url(${scene.imagePath || ScenePlaceholder})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            />
            <div>
              <p className={styles.title}>{scene.title}</p>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
};
