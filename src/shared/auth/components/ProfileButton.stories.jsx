import { ProfileButton } from './ProfileButton';

export default {
  title: 'Shared/Auth/ProfileButton',
  component: ProfileButton,
  parameters: {
    layout: 'centered',
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
    currentUser: {
      description: 'Current user object',
      control: 'object'
    },
    isLoading: {
      description: 'Loading state',
      control: 'boolean'
    },
    onClick: { action: 'clicked' },
    tooltipSide: {
      description: 'Side for tooltip placement',
      control: 'select',
      options: ['top', 'right', 'bottom', 'left']
    }
  }
};

// Not signed in state
export const NotSignedIn = {
  args: {
    currentUser: null,
    isLoading: false,
    tooltipSide: 'bottom'
  }
};

// Loading state
export const Loading = {
  args: {
    currentUser: null,
    isLoading: true,
    tooltipSide: 'bottom'
  }
};

// User with profile photo (Google)
export const WithProfilePhoto = {
  args: {
    currentUser: {
      uid: 'user123',
      email: 'photo@example.com',
      displayName: 'Photo User',
      photoURL: 'https://i.pravatar.cc/150?img=1',
      isPro: false,
      providerData: [{ providerId: 'google.com' }]
    },
    isLoading: false,
    tooltipSide: 'bottom'
  }
};
