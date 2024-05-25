import { Logo } from './Logo.component';
import { action } from '@storybook/addon-actions';

export default {
  component: Logo,
  title: 'UI-KIT/Logo'
};

const Default = {
  args: {
    Logo: {
      onToggleEdit: action('on toggle'),
      isEditor: false
    }
  }
};

export { Default };
