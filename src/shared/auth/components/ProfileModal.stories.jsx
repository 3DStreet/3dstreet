import SharedProfileModal from './ProfileModal';
import { AuthProvider } from '../../../editor/contexts';

export default {
  title: 'Shared/Auth/ProfileModal',
  component: SharedProfileModal,
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
    showEscapeHatch: {
      description: 'Show button to open full profile in 3DStreet Editor',
      control: 'boolean'
    },
    onClose: { action: 'closed' }
  }
};

// Mock user with tokens
const mockUserWithTokens = {
  uid: 'user123',
  email: 'user@example.com',
  displayName: 'John Doe',
  photoURL: 'https://i.pravatar.cc/150?img=3',
  providerData: [{ providerId: 'google.com' }]
};

const mockTokenProfile = {
  remainingTokens: 250,
  totalTokens: 1000,
  plan: 'PRO'
};

// Mock user without tokens
const mockUserNoTokens = {
  uid: 'user456',
  email: 'basic@example.com',
  displayName: 'Jane Smith',
  photoURL: null,
  providerData: [{ providerId: 'microsoft.com' }]
};

// Story with authenticated user and tokens
export const WithTokens = {
  args: {
    isOpen: true,
    showEscapeHatch: false
  },
  decorators: [
    (Story) => (
      <AuthProvider
        value={{
          currentUser: mockUserWithTokens,
          setCurrentUser: () => {},
          tokenProfile: mockTokenProfile
        }}
      >
        <Story />
      </AuthProvider>
    )
  ]
};

// Story with authenticated user but no token profile
export const WithoutTokens = {
  args: {
    isOpen: true,
    showEscapeHatch: false
  },
  decorators: [
    (Story) => (
      <AuthProvider
        value={{
          currentUser: mockUserNoTokens,
          setCurrentUser: () => {},
          tokenProfile: null
        }}
      >
        <Story />
      </AuthProvider>
    )
  ]
};

// Story with escape hatch button
export const WithEscapeHatch = {
  args: {
    isOpen: true,
    showEscapeHatch: true
  },
  decorators: [
    (Story) => (
      <AuthProvider
        value={{
          currentUser: mockUserWithTokens,
          setCurrentUser: () => {},
          tokenProfile: mockTokenProfile
        }}
      >
        <Story />
      </AuthProvider>
    )
  ]
};

// Story with user with no profile photo (Microsoft)
export const NoProfilePhoto = {
  args: {
    isOpen: true,
    showEscapeHatch: false
  },
  decorators: [
    (Story) => (
      <AuthProvider
        value={{
          currentUser: mockUserNoTokens,
          setCurrentUser: () => {},
          tokenProfile: mockTokenProfile
        }}
      >
        <Story />
      </AuthProvider>
    )
  ]
};

// Closed modal
export const Closed = {
  args: {
    isOpen: false,
    showEscapeHatch: false
  },
  decorators: [
    (Story) => (
      <AuthProvider
        value={{
          currentUser: mockUserWithTokens,
          setCurrentUser: () => {},
          tokenProfile: mockTokenProfile
        }}
      >
        <Story />
      </AuthProvider>
    )
  ]
};
