import Modal from '../Modal.jsx';
import MuxPlayer from '@mux/mux-player-react';

const IntroModal = ({ isOpen, onClose }) => {
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
