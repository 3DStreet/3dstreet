import { useState } from 'react';
import RenderStyleSelector from './RenderStyleSelector.component';
import {
  RENDER_STYLES,
  buildStyledPrompt
} from '@shared/constants/renderStyles.js';

export default {
  title: 'Shared/Components/RenderStyleSelector',
  component: RenderStyleSelector,
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
    value: {
      description: 'Currently selected style ID',
      control: 'select',
      options: Object.keys(RENDER_STYLES)
    },
    onChange: {
      description: 'Callback when style selection changes',
      action: 'onChange'
    },
    disabled: {
      description: 'Disable the selector',
      control: 'boolean'
    }
  }
};

const InteractiveWrapper = ({ initialValue = 'photorealistic', disabled }) => {
  const [selectedStyle, setSelectedStyle] = useState(initialValue);

  return (
    <div style={{ width: '360px' }}>
      <RenderStyleSelector
        value={selectedStyle}
        onChange={setSelectedStyle}
        disabled={disabled}
      />
      <div style={{ marginTop: '16px', fontSize: '13px', color: '#9ca3af' }}>
        <p>
          Selected: <strong>{selectedStyle}</strong>
        </p>
        <p style={{ marginTop: '8px' }}>
          Composed prompt:{' '}
          <em>
            {buildStyledPrompt({
              userPrompt: '',
              modelDefaultPrompt:
                'photorealistic street view, professional photography',
              styleId: selectedStyle
            })}
          </em>
        </p>
      </div>
    </div>
  );
};

export const Default = {
  render: () => <InteractiveWrapper />,
  parameters: {
    docs: {
      description: {
        story:
          'Default state with the photorealistic style selected. Selecting any other style appends its style description to the generation prompt.'
      }
    }
  }
};

export const StyledSelection = {
  render: () => <InteractiveWrapper initialValue="watercolor" />,
  parameters: {
    docs: {
      description: {
        story: 'Watercolor style selected, showing the composed prompt below.'
      }
    }
  }
};

export const Disabled = {
  render: () => <InteractiveWrapper disabled={true} />,
  parameters: {
    docs: {
      description: {
        story: 'Disabled state prevents interaction during generation.'
      }
    }
  }
};
