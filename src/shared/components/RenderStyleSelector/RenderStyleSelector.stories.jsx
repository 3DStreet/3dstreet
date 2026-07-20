import { useState } from 'react';
import RenderStyleSelector from './RenderStyleSelector.component';
import {
  DEFAULT_RENDER_STYLE_ID,
  getDefaultInstructions,
  getStyleSentence,
  describeStyleText,
  composePrompt
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
    activeStyleId: {
      description:
        "describeStyleText result for the style field ('none' lights the none chip; 'custom' lights nothing)"
    },
    onSelect: {
      description: 'Callback with the clicked style ID',
      action: 'onSelect'
    },
    disabled: {
      description: 'Disable the selector',
      control: 'boolean'
    }
  }
};

const fieldStyle = {
  width: '100%',
  fontSize: '12px',
  padding: '8px',
  borderRadius: '6px'
};

/**
 * Mirrors how both apps wire the component: the prompt is two stacked
 * fields (instructions + style sentence) joined verbatim by composePrompt.
 * Chips write only the style field; the highlight derives from whether the
 * style field still holds an unedited chip sentence.
 */
const InteractiveWrapper = ({ initialStyleText, disabled }) => {
  const [instructions, setInstructions] = useState(getDefaultInstructions());
  const [styleText, setStyleText] = useState(
    initialStyleText ?? getStyleSentence(DEFAULT_RENDER_STYLE_ID)
  );

  return (
    <div style={{ width: '360px' }}>
      <p style={{ fontSize: '11px', color: '#9ca3af' }}>Instructions</p>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={3}
        style={fieldStyle}
      />
      <p style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px' }}>
        Style
      </p>
      <RenderStyleSelector
        activeStyleId={describeStyleText(styleText)}
        onSelect={(styleId) => setStyleText(getStyleSentence(styleId))}
        disabled={disabled}
      />
      <textarea
        value={styleText}
        onChange={(e) => setStyleText(e.target.value)}
        placeholder="No style; instructions only"
        rows={3}
        style={{ ...fieldStyle, marginTop: '8px' }}
      />
      <p style={{ marginTop: '8px', fontSize: '13px', color: '#9ca3af' }}>
        Sent prompt:{' '}
        <em>
          {composePrompt({ instructions, style: styleText }) || '(empty)'}
        </em>
      </p>
    </div>
  );
};

export const Default = {
  render: () => <InteractiveWrapper />,
  parameters: {
    docs: {
      description: {
        story:
          'Default state: both fields prefilled (geometry-guidance instructions + photorealistic style sentence). Clicking a chip swaps only the style sentence; instructions survive. Editing the style text clears the highlight; the ∅ chip empties it.'
      }
    }
  }
};

export const NoStyle = {
  render: () => <InteractiveWrapper initialStyleText="" />,
  parameters: {
    docs: {
      description: {
        story:
          'Empty style field: the none chip is highlighted and the sent prompt is instructions only.'
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
