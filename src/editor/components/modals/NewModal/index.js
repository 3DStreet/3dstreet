import Modal from '../Modal.jsx';
import useStore from '@/store.js';
import { Button } from '../../components/index.js';
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

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div>NewModal</div>
      <Button onClick={onClickNew}>New</Button>
    </Modal>
  );
};
