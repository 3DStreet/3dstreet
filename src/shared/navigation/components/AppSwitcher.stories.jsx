import AppSwitcher from './AppSwitcher';

export default {
  title: 'Shared/Navigation/AppSwitcher',
  component: AppSwitcher,
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'light',
      values: [
        { name: 'dark', value: '#1a1a1a' },
        { name: 'light', value: '#ffffff' }
      ]
    }
  },
  tags: ['autodocs']
};

// Default story showing the AppSwitcher
export const Default = {
  render: () => <AppSwitcher />
};

// Story showing AppSwitcher in a toolbar-like context
export const InToolbar = {
  render: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '12px',
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(4px)',
        borderRadius: '6px'
      }}
    >
      <AppSwitcher />
      <div style={{ color: 'white', fontSize: '14px' }}>
        Additional toolbar items...
      </div>
    </div>
  ),
  parameters: {
    backgrounds: {
      default: 'dark'
    },
    docs: {
      description: {
        story: 'AppSwitcher shown in a toolbar context with other elements.'
      }
    }
  }
};

// Story showing the component on a dark background
export const DarkBackground = {
  render: () => (
    <div
      style={{
        backgroundColor: '#1a1a1a',
        padding: '40px',
        borderRadius: '8px'
      }}
    >
      <AppSwitcher />
    </div>
  )
};
