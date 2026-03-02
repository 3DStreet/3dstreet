import { useState } from 'react';
import AIModelSelector from './AIModelSelector.component';

export default {
  title: 'Shared/Components/AIModelSelector',
  component: AIModelSelector,
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
  tags: ['autodocs'],
  argTypes: {
    value: {
      description: 'Currently selected model ID',
      control: 'text'
    },
    onChange: {
      description: 'Callback when model selection changes',
      action: 'onChange'
    },
    disabled: {
      description: 'Disable the selector',
      control: 'boolean'
    },
    mode: {
      description: 'Selector mode: image or video models',
      control: 'select',
      options: ['image', 'video']
    }
  }
};

// Interactive wrapper for stories
const InteractiveWrapper = ({ initialValue, mode, disabled }) => {
  const [selectedModel, setSelectedModel] = useState(initialValue);

  return (
    <div>
      <AIModelSelector
        value={selectedModel}
        onChange={setSelectedModel}
        mode={mode}
        disabled={disabled}
      />
      <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
        Selected: <strong>{selectedModel}</strong>
      </div>
    </div>
  );
};

// Default image model selector
export const Default = {
  render: () => (
    <InteractiveWrapper initialValue="kontext-realearth" mode="image" />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Default image model selector with Kontext Real Earth selected. Click to see all available image models grouped by quality.'
      }
    }
  }
};

// Best quality model selected
export const BestQualityModel = {
  render: () => (
    <InteractiveWrapper initialValue="nano-banana-pro" mode="image" />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Shows a high-cost premium model (Nano Banana Pro) with token cost badge displayed.'
      }
    }
  }
};

// Versatile model selected
export const VersatileModel = {
  render: () => (
    <InteractiveWrapper initialValue="flux-kontext-pro" mode="image" />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Shows a versatile model option with balanced performance and cost.'
      }
    }
  }
};

// Video mode
export const VideoMode = {
  render: () => (
    <InteractiveWrapper
      initialValue="kwaivgi/kling-v2.5-turbo-pro"
      mode="video"
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Video model selector showing video-specific models. Note that token costs are not displayed in video mode.'
      }
    }
  }
};

// Video mode - fast model
export const VideoModeFast = {
  render: () => (
    <InteractiveWrapper
      initialValue="bytedance/seedance-1-pro-fast"
      mode="video"
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Video mode with a high quality and fast model selected.'
      }
    }
  }
};

// Disabled state
export const Disabled = {
  render: () => (
    <InteractiveWrapper
      initialValue="kontext-realearth"
      mode="image"
      disabled={true}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Disabled state prevents interaction. Useful when generation is in progress.'
      }
    }
  }
};

// Deprecated model (hidden from dropdown)
export const DeprecatedModel = {
  render: () => <InteractiveWrapper initialValue="flux-dev" mode="image" />,
  parameters: {
    docs: {
      description: {
        story:
          "Shows a deprecated model (flux-dev) that has group: null. The model name displays but it won't appear in the dropdown options. Used for backwards compatibility with old gallery items."
      }
    }
  }
};

// In a form context
export const InFormContext = {
  render: () => (
    <div
      style={{
        padding: '24px',
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        width: '400px'
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        <label
          style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: '600',
            fontSize: '14px'
          }}
        >
          AI Model
        </label>
        <InteractiveWrapper initialValue="kontext-realearth" mode="image" />
      </div>
      <div style={{ marginBottom: '16px' }}>
        <label
          style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: '600',
            fontSize: '14px'
          }}
        >
          Prompt
        </label>
        <textarea
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontFamily: 'sans-serif',
            fontSize: '14px',
            minHeight: '80px'
          }}
          placeholder="Describe the image you want to generate..."
        />
      </div>
      <button
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontWeight: '600',
          cursor: 'pointer'
        }}
      >
        Generate Image
      </button>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'AIModelSelector used within a typical form context.'
      }
    }
  }
};

// Controlled component wrapper
const ControlledWrapper = () => {
  const [model, setModel] = useState('seedream-4');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <AIModelSelector value={model} onChange={setModel} mode="image" />
      <div style={{ fontSize: '14px' }}>
        <p>
          Current selection: <strong>{model}</strong>
        </p>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={() => setModel('nano-banana-pro')}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              cursor: 'pointer'
            }}
          >
            Set to Nano Banana Pro
          </button>
          <button
            onClick={() => setModel('kontext-realearth')}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              cursor: 'pointer'
            }}
          >
            Set to Kontext Real Earth
          </button>
        </div>
      </div>
    </div>
  );
};

// Controlled vs Uncontrolled
export const ControlledExample = {
  render: () => <ControlledWrapper />,
  parameters: {
    docs: {
      description: {
        story:
          'Demonstrates controlled component behavior. External buttons can programmatically change the selection.'
      }
    }
  }
};

// All models showcase
export const AllImageModels = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h3 style={{ margin: 0, fontSize: '16px' }}>Best Quality</h3>
      <InteractiveWrapper initialValue="nano-banana-pro" mode="image" />

      <h3 style={{ margin: 0, fontSize: '16px', marginTop: '8px' }}>
        High Quality and Fast
      </h3>
      <InteractiveWrapper initialValue="kontext-realearth" mode="image" />
      <InteractiveWrapper initialValue="seedream-4" mode="image" />

      <h3 style={{ margin: 0, fontSize: '16px', marginTop: '8px' }}>
        Versatile
      </h3>
      <InteractiveWrapper initialValue="flux-kontext-pro" mode="image" />
      <InteractiveWrapper initialValue="nano-banana" mode="image" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcases all available image models grouped by category.'
      }
    }
  }
};

// All video models showcase
export const AllVideoModels = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h3 style={{ margin: 0, fontSize: '16px' }}>Best Quality</h3>
      <InteractiveWrapper
        initialValue="kwaivgi/kling-v2.5-turbo-pro"
        mode="video"
      />

      <h3 style={{ margin: 0, fontSize: '16px', marginTop: '8px' }}>
        High Quality and Fast
      </h3>
      <InteractiveWrapper
        initialValue="bytedance/seedance-1-pro-fast"
        mode="video"
      />
      <InteractiveWrapper initialValue="lightricks/ltx-2-fast" mode="video" />

      <h3 style={{ margin: 0, fontSize: '16px', marginTop: '8px' }}>
        Versatile
      </h3>
      <InteractiveWrapper
        initialValue="wan-video/wan-2.2-i2v-fast"
        mode="video"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Showcases all available video models grouped by category.'
      }
    }
  }
};
