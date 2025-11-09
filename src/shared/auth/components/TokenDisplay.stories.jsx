import { TokenDisplayInner } from './TokenDisplay';
import { AuthContext } from '@shared/contexts';

// Mock AuthProvider for Storybook that provides fake auth data
const MockAuthProvider = ({ children, mockUser, mockTokenProfile }) => (
  <AuthContext.Provider
    value={{
      currentUser: mockUser,
      setCurrentUser: () => {},
      tokenProfile: mockTokenProfile,
      refreshTokenProfile: () => {},
      isLoading: false
    }}
  >
    {children}
  </AuthContext.Provider>
);

export default {
  title: 'Shared/Auth/TokenDisplay',
  component: TokenDisplayInner,
  decorators: [
    (Story, context) => (
      <MockAuthProvider
        mockUser={context.args.mockUser}
        mockTokenProfile={context.args.mockTokenProfile}
      >
        <Story />
      </MockAuthProvider>
    )
  ],
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
    showLabel: {
      description: 'Show token label text',
      control: 'boolean'
    },
    useContainer: {
      description: 'Wrap in container div',
      control: 'boolean'
    },
    inline: {
      description: 'Use inline variant (for buttons)',
      control: 'boolean'
    },
    tokenType: {
      description: 'Type of token to display',
      control: 'select',
      options: ['genToken', 'geoToken']
    },
    mockUser: {
      description: 'Mock user object for Storybook',
      control: 'object',
      table: { category: 'Mock Data' }
    },
    mockTokenProfile: {
      description: 'Mock token profile for Storybook',
      control: 'object',
      table: { category: 'Mock Data' }
    }
  }
};

// Default AI Generation Tokens
export const Default = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 50, geoToken: 10 },
    showLabel: false,
    tokenType: 'genToken'
  }
};

// With label shown
export const WithLabel = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 100, geoToken: 25 },
    showLabel: true,
    tokenType: 'genToken'
  }
};

// Low tokens warning state
export const LowTokens = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 3, geoToken: 1 },
    showLabel: false,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story:
          'When tokens are running low, consider showing a warning or upgrade prompt.'
      }
    }
  }
};

// High token count (Pro user)
export const ProUser = {
  args: {
    mockUser: {
      uid: 'pro-user',
      email: 'pro@example.com',
      isPro: true
    },
    mockTokenProfile: { genToken: 500, geoToken: 200 },
    showLabel: true,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story: 'Pro users typically have higher token counts.'
      }
    }
  }
};

// Geo Tokens
export const GeoTokens = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 50, geoToken: 25 },
    showLabel: true,
    tokenType: 'geoToken'
  },
  parameters: {
    docs: {
      description: {
        story: 'Display geo tokens instead of generation tokens.'
      }
    }
  }
};

// Inline variant (for use in buttons)
export const InlineVariant = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 42, geoToken: 15 },
    showLabel: false,
    inline: true,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story:
          'Inline variant for compact display inside buttons or small spaces.'
      }
    }
  }
};

// With container
export const WithContainer = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 75, geoToken: 30 },
    showLabel: true,
    useContainer: true,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story: 'Wrapped in a container div for additional styling control.'
      }
    }
  }
};

// Not signed in (should render nothing)
export const NotSignedIn = {
  args: {
    mockUser: null,
    mockTokenProfile: null,
    showLabel: true
  },
  parameters: {
    docs: {
      description: {
        story:
          'When user is not signed in, the component returns null and renders nothing.'
      }
    }
  }
};

// No tokens available (should render nothing)
export const NoTokens = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 0, geoToken: 0 },
    showLabel: true,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story:
          'When token count is 0, component should still display (0 is valid).'
      }
    }
  }
};

// Multiple tokens shown together
export const BothTokenTypes = {
  render: (args) => (
    <MockAuthProvider
      mockUser={args.mockUser}
      mockTokenProfile={args.mockTokenProfile}
    >
      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
        <TokenDisplayInner showLabel={true} tokenType="genToken" />
        <TokenDisplayInner showLabel={true} tokenType="geoToken" />
      </div>
    </MockAuthProvider>
  ),
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 150, geoToken: 75 }
  },
  parameters: {
    docs: {
      description: {
        story: 'Display both token types side by side.'
      }
    }
  }
};

// Custom label and icon (using override props)
export const CustomLabelAndIcon = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 99 },
    showLabel: true,
    label: 'Custom Tokens',
    count: 99,
    iconSrc: '/ui_assets/token-image.png'
  },
  parameters: {
    docs: {
      description: {
        story:
          'Override default label and provide custom count/icon for specialized use cases.'
      }
    }
  }
};

// With Details Card (hover to see dropdown)
export const WithDetailsCard = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 50, geoToken: 10 },
    showLabel: true,
    showDetails: true,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story:
          'Shows the token details card on hover with purchase button and token info.'
      }
    }
  }
};

// With Details Card - Low Tokens
export const WithDetailsCardLowTokens = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 3, geoToken: 1 },
    showLabel: true,
    showDetails: true,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story:
          'Shows the token details card with low token warning and purchase prompt.'
      }
    }
  }
};

// With Details Card - Out of Tokens
export const WithDetailsCardNoTokens = {
  args: {
    mockUser: { uid: 'user123', email: 'test@example.com' },
    mockTokenProfile: { genToken: 0, geoToken: 0 },
    showLabel: true,
    showDetails: true,
    tokenType: 'genToken'
  },
  parameters: {
    docs: {
      description: {
        story:
          'Shows the token details card when completely out of tokens with urgent purchase prompt.'
      }
    }
  }
};
