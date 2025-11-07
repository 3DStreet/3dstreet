/**
 * Mount Purchase Modal - Renders React purchase modal and handles events
 */

import { createRoot } from 'react-dom/client';
import { AuthProvider } from '../editor/contexts';
import PurchaseModal from './components/PurchaseModal.jsx';
import useImageGenStore from './store.js';

/**
 * Mount the Purchase Modal component
 * Creates a portal div if it doesn't exist
 */
export const mountPurchaseModal = () => {
  // Create or get the modal root element
  let modalRoot = document.getElementById('purchase-modal-root');

  if (!modalRoot) {
    modalRoot = document.createElement('div');
    modalRoot.id = 'purchase-modal-root';
    document.body.appendChild(modalRoot);
  }

  const root = createRoot(modalRoot);
  root.render(
    <AuthProvider>
      <PurchaseModal />
    </AuthProvider>
  );

  // Listen for custom events to open the modal
  window.addEventListener('openPurchaseModal', (event) => {
    useImageGenStore.getState().setModal('purchase');
  });
};

export default mountPurchaseModal;
