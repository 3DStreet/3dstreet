import Modal from '../Modal.jsx';
import useStore from '@/store.js';
import styles from './NewModal.module.scss';
import ScenePlaceholder from '@/../ui_assets/ScenePlaceholder.svg';
import { inputStreetmix } from '@/editor/lib/SceneUtils.js';
import { Button } from '@/editor/components/components';
import { Load24Icon } from '@/editor/icons';

export const NewModal = () => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'new');
  const saveScene = useStore((state) => state.saveScene);
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
    }
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create a New Scene"
      titleElement={
        <div className="flex items-center justify-between pr-4 pt-4">
          <div className="font-large text-center text-2xl">
            Create a New Scene
          </div>
          <Button
            onClick={() => {
              setModal('scenes');
            }}
            leadingIcon={<Load24Icon />}
          >
            Open Scene
          </Button>
        </div>
      }
    >
      <div className={styles.wrapper}>
        {scenesData?.map((scene, index) => (
          <div key={index} className={styles.card} title={scene.title}>
            <div
              className={styles.img}
              onClick={(event) => {
                scene.onClick(event);
                saveScene(true);
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
