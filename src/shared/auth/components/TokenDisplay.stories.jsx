import { TokenDisplayInner } from './TokenDisplay';
import { AuthProvider } from '../../../editor/contexts';

export default {
  title: 'Shared/Auth/TokenDisplay',
  component: TokenDisplayInner,
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
      description: 'Show token type label',
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
    count: {
      description: 'Token count override',
      control: 'number'
    }
  },
  decorators: [
    (Story) => (
      <AuthProvider>
        <div style={{ padding: '20px' }}>
          <Story />
        </div>
      </AuthProvider>
    )
  ]
};

// Default with generation tokens
export const Default = {
  args: {
    showLabel: false,
    useContainer: false,
    inline: false,
    tokenType: 'genToken',
    count: 50
  }
};

// With label
export const WithLabel = {
  args: {
    showLabel: true,
    useContainer: false,
    inline: false,
    tokenType: 'genToken',
    count: 50
  }
};

// Geo tokens
export const GeoTokens = {
  args: {
    showLabel: true,
    useContainer: false,
    inline: false,
    tokenType: 'geoToken',
    count: 10
  }
};

// Inline variant (for use in buttons)
export const Inline = {
  args: {
    showLabel: false,
    useContainer: false,
    inline: true,
    tokenType: 'genToken',
    count: 50
  }
};

// With container
export const WithContainer = {
  args: {
    showLabel: true,
    useContainer: true,
    inline: false,
    tokenType: 'genToken',
    count: 50
  }
};

// Low token count
export const LowTokens = {
  args: {
    showLabel: true,
    useContainer: false,
    inline: false,
    tokenType: 'genToken',
    count: 3
  }
};

// No tokens
export const NoTokens = {
  args: {
    showLabel: true,
    useContainer: false,
    inline: false,
    tokenType: 'genToken',
    count: 0
  }
};

// High token count
export const HighTokens = {
  args: {
    showLabel: true,
    useContainer: false,
    inline: false,
    tokenType: 'genToken',
    count: 9999
  }
};
