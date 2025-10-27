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

// Signed in with basic user
export const SignedIn = {
  args: {
    currentUser: {
      uid: 'user123',
      email: 'user@example.com',
      displayName: 'John Doe',
      photoURL: null,
      isPro: false,
      providerData: [{ providerId: 'password' }]
    },
    isLoading: false,
    tooltipSide: 'bottom'
  }
};

// Signed in with Pro user
export const ProUser = {
  args: {
    currentUser: {
      uid: 'user123',
      email: 'pro@example.com',
      displayName: 'Jane Pro',
      photoURL: null,
      isPro: true,
      isProTeam: false,
      providerData: [{ providerId: 'password' }]
    },
    isLoading: false,
    tooltipSide: 'bottom'
  }
};

// Signed in with Pro Team user
export const ProTeamUser = {
  args: {
    currentUser: {
      uid: 'user123',
      email: 'team@example.com',
      displayName: 'Team User',
      photoURL: null,
      isPro: true,
      isProTeam: true,
      teamDomain: 'example.com',
      providerData: [{ providerId: 'password' }]
    },
    isLoading: false,
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
