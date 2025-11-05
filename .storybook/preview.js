// Import Tailwind CSS
import '../src/styles/tailwind.css';

/** @type { import('@storybook/react-webpack5').Preview } */
const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    },
    backgrounds: {
      default: 'dark',
      values: [
        {
          name: 'dark',
          value: '#1a1a1a'
        },
        {
          name: 'light',
          value: '#ffffff'
        },
        {
          name: 'toolbar',
          value: '#2d2d2d'
        }
      ]
    }
  }
};

export default preview;
