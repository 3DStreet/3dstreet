import PurchaseModal from './PurchaseModal';
import useImageGenStore from '../store';
import { useEffect } from 'react';

// Wrapper component to control modal state
const PurchaseModalWrapper = ({ isOpen, onPurchase }) => {
  const setModal = useImageGenStore((state) => state.setModal);

  useEffect(() => {
    setModal(isOpen ? 'purchase' : null);
  }, [isOpen, setModal]);

  // Mock the purchase handler if provided
  useEffect(() => {
    if (onPurchase) {
      const originalAlert = window.alert;
      window.alert = (msg) => {
        onPurchase(msg);
        originalAlert(msg);
      };
      return () => {
        window.alert = originalAlert;
      };
    }
  }, [onPurchase]);

  return <PurchaseModal />;
};

export default {
  title: 'Image Generator/PurchaseModal',
  component: PurchaseModal,
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1a1a1a' },
        { name: 'light', value: '#ffffff' }
      ]
    }
  },
  tags: ['autodocs'],
  argTypes: {
    isOpen: {
      description: 'Controls whether the modal is open',
      control: 'boolean'
    },
    onPurchase: {
      description: 'Callback when a plan is selected',
      action: 'purchase'
    }
  }
};

// Default open modal
export const Default = {
  render: (args) => <PurchaseModalWrapper {...args} />,
  args: {
    isOpen: true
  },
  parameters: {
    docs: {
      description: {
        story:
          'The purchase modal showing Pro Monthly and Pro Annual plans with token details.'
      }
    }
  }
};

// Closed modal (to show toggle behavior)
export const Closed = {
  render: (args) => <PurchaseModalWrapper {...args} />,
  args: {
    isOpen: false
  },
  parameters: {
    docs: {
      description: {
        story: 'Modal in closed state. Toggle the isOpen control to see it.'
      }
    }
  }
};
