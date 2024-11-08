import Modal from '../Modal.jsx';
import MuxPlayer from '@mux/mux-player-react';
import useStore from '@/store.js';

const IntroModal = () => {
  const isOpen = useStore((state) => state.modal === 'intro');
  const onClose = () => {
    useStore.setState({ modal: null });
    localStorage.setItem('shownIntro', true);
  };
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Welcome to 3DStreet">
      <MuxPlayer
        streamType="on-demand"
        playbackId="TSxTjFBKoeTnspoQo02BFBPZXel6Pqtoo"
        primaryColor="#FFFFFF"
        secondaryColor="#000000"
        accentColor="#653CB0"
      />
    </Modal>
  );
};

export { IntroModal };
