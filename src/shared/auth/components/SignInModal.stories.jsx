import { SignInModal } from './SignInModal';

export default {
  title: 'Shared/Auth/SignInModal',
  component: SignInModal,
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: '600px', height: '400px' }}>
        <Story />
      </div>
    )
  ],
  argTypes: {
    isOpen: {
      description: 'Controls modal visibility',
      control: 'boolean'
    },
    message: {
      description: 'Custom message to display in the modal',
      control: 'text'
    },
    loadingMessage: {
      description: 'Message shown during authentication',
      control: 'text'
    },
    onClose: { action: 'closed' },
    onAnalytics: { action: 'analytics-event' },
    onNotification: { action: 'notification-sent' },
    onSuccess: { action: 'sign-in-success' }
  }
};

// Mock Firebase auth instance
const mockFirebaseAuth = {
  currentUser: null,
  signInWithPopup: async () => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          user: { uid: 'user123', email: 'user@example.com' }
        });
      }, 1000);
    });
  }
};

// Default open state
export const Default = {
  args: {
    isOpen: true,
    message: 'Sign in to continue',
    firebaseAuth: mockFirebaseAuth,
    loadingMessage: 'Signing in...'
  }
};

// Custom message
export const CustomMessage = {
  args: {
    isOpen: true,
    message: 'Sign in to generate AI images',
    firebaseAuth: mockFirebaseAuth
  }
};

// With custom loading message
export const CustomLoadingMessage = {
  args: {
    isOpen: true,
    message: 'Sign in to continue',
    firebaseAuth: mockFirebaseAuth,
    loadingMessage: 'Authenticating with Google...'
  }
};

// Closed modal
export const Closed = {
  args: {
    isOpen: false,
    message: 'Sign in to continue',
    firebaseAuth: mockFirebaseAuth
  }
};

// With custom loading component
export const WithCustomLoading = {
  args: {
    isOpen: true,
    message: 'Sign in to continue',
    firebaseAuth: mockFirebaseAuth,
    LoadingComponent: () => (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: '18px'
        }}
      >
        Custom Loading Component
      </div>
    )
  }
};

// Long message example
export const LongMessage = {
  args: {
    isOpen: true,
    message:
      'Sign in to unlock premium features, save your work, and collaborate with your team. Your account gives you access to advanced tools and resources.',
    firebaseAuth: mockFirebaseAuth
  }
};
