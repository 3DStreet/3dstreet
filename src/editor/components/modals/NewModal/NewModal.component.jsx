import Modal from '../Modal.jsx';
import useStore from '@/store.js';
import styles from './NewModal.module.scss';
import ScenePlaceholder from '@/../ui_assets/ScenePlaceholder.svg';
import { createBlankScene, inputStreetmix } from '@/editor/lib/SceneUtils.js';
import { Button } from '@/editor/components/elements';
import { Upload24Icon } from '@/editor/icons';

export const NewModal = () => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'new');
  const saveScene = useStore((state) => state.saveScene);
  const onClose = () => {
    setModal(null);
  };

  const scenesData = [
    {
      title: 'Create Blank Scene',
      imagePath: '/ui_assets/cards/new-blank.jpg',
      onClick: createBlankScene
    },
    {
      title: 'Import From Streetmix',
      imagePath: '/ui_assets/cards/new-streetmix-import.jpg',
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
            leadingIcon={<Upload24Icon />}
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
                onClose();
                AFRAME.scenes[0].addEventListener(
                  'newScene',
                  () => {
                    saveScene(true);
                  },
                  { once: true }
                );
                scene.onClick(event);
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
