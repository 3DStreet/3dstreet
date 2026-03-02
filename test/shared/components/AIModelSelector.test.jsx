/**
 * AIModelSelector Component Tests
 *
 * Tests the AI model dropdown selector including:
 * - Rendering with image and video modes
 * - Model selection
 * - Grouped model display
 * - Token cost display
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIModelSelector from '../../../src/shared/components/AIModelSelector/AIModelSelector.component';

// Mock the model constants
vi.mock('@shared/constants/replicateModels.js', () => ({
  REPLICATE_MODELS: {
    'flux-kontext-pro': {
      name: 'Flux Kontext Pro',
      type: 'replicate',
      group: 'versatile',
      logo: '/logo-flux.png',
      tokenCost: 1
    },
    'flux-pro-1.1': {
      name: 'Flux Pro 1.1',
      type: 'bfl',
      group: 'quality',
      logo: '/logo-flux.png',
      tokenCost: 2
    },
    'flux-schnell': {
      name: 'Flux Schnell',
      type: 'bfl',
      group: 'fast',
      logo: '/logo-flux.png',
      tokenCost: 0
    }
  },
  MODEL_GROUPS: {
    versatile: { label: 'Versatile Models', order: 1 },
    quality: { label: 'Quality Models', order: 2 },
    fast: { label: 'Fast Models', order: 3 }
  },
  getGroupedModels: () => ({
    versatile: [
      {
        id: 'flux-kontext-pro',
        name: 'Flux Kontext Pro',
        logo: '/logo-flux.png',
        tokenCost: 1
      }
    ],
    quality: [
      {
        id: 'flux-pro-1.1',
        name: 'Flux Pro 1.1',
        logo: '/logo-flux.png',
        tokenCost: 2
      }
    ],
    fast: [
      {
        id: 'flux-schnell',
        name: 'Flux Schnell',
        logo: '/logo-flux.png',
        tokenCost: 0
      }
    ]
  }),
  VIDEO_MODELS: {
    'video-model-1': {
      name: 'Video Model 1',
      type: 'replicate',
      group: 'standard',
      logo: '/logo-video.png'
    }
  },
  VIDEO_MODEL_GROUPS: {
    standard: { label: 'Standard Video', order: 1 }
  },
  getGroupedVideoModels: () => ({
    standard: [
      { id: 'video-model-1', name: 'Video Model 1', logo: '/logo-video.png' }
    ]
  })
}));

// Mock the TokenDisplayBase component
vi.mock('@shared/auth/components', () => ({
  TokenDisplayBase: ({ count, inline, compact }) => (
    <span data-testid="token-cost">{count} tokens</span>
  )
}));

describe('AIModelSelector', () => {
  const defaultProps = {
    value: 'flux-kontext-pro',
    onChange: vi.fn(),
    disabled: false,
    mode: 'image'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render with selected model name', () => {
      render(<AIModelSelector {...defaultProps} />);
      expect(screen.getByText('Flux Kontext Pro')).toBeInTheDocument();
    });

    it('should show "Select Model" when value is invalid', () => {
      render(<AIModelSelector {...defaultProps} value="invalid-model" />);
      expect(screen.getByText('Select Model')).toBeInTheDocument();
    });

    it('should show token cost for selected model', () => {
      render(<AIModelSelector {...defaultProps} />);
      expect(screen.getByTestId('token-cost')).toHaveTextContent('1 tokens');
    });

    it('should not show token cost for free models', () => {
      render(<AIModelSelector {...defaultProps} value="flux-schnell" />);
      // Flux Schnell has tokenCost: 0, so no token badge should appear
      const tokenBadges = screen.queryAllByTestId('token-cost');
      expect(tokenBadges.length).toBe(0);
    });
  });

  describe('Dropdown Behavior', () => {
    it('should open dropdown when trigger is clicked', async () => {
      const user = userEvent.setup();
      render(<AIModelSelector {...defaultProps} />);

      await user.click(screen.getByText('Flux Kontext Pro'));

      await waitFor(() => {
        expect(screen.getByText('Versatile Models')).toBeInTheDocument();
      });
    });

    it('should show all model groups when open', async () => {
      const user = userEvent.setup();
      render(<AIModelSelector {...defaultProps} />);

      await user.click(screen.getByText('Flux Kontext Pro'));

      await waitFor(() => {
        expect(screen.getByText('Versatile Models')).toBeInTheDocument();
        expect(screen.getByText('Quality Models')).toBeInTheDocument();
        expect(screen.getByText('Fast Models')).toBeInTheDocument();
      });
    });

    it('should show all models in dropdown', async () => {
      const user = userEvent.setup();
      render(<AIModelSelector {...defaultProps} />);

      await user.click(screen.getByText('Flux Kontext Pro'));

      await waitFor(() => {
        // These should be in the dropdown menu
        expect(screen.getByText('Flux Pro 1.1')).toBeInTheDocument();
        expect(screen.getByText('Flux Schnell')).toBeInTheDocument();
      });
    });
  });

  describe('Model Selection', () => {
    it('should call onChange when a model is selected', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<AIModelSelector {...defaultProps} onChange={onChange} />);

      await user.click(screen.getByText('Flux Kontext Pro'));

      await waitFor(() => {
        expect(screen.getByText('Flux Pro 1.1')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Flux Pro 1.1'));

      expect(onChange).toHaveBeenCalledWith('flux-pro-1.1');
    });

    it('should close dropdown after selection', async () => {
      const user = userEvent.setup();
      render(<AIModelSelector {...defaultProps} />);

      await user.click(screen.getByText('Flux Kontext Pro'));

      await waitFor(() => {
        expect(screen.getByText('Quality Models')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Flux Pro 1.1'));

      await waitFor(() => {
        expect(screen.queryByText('Quality Models')).not.toBeInTheDocument();
      });
    });
  });

  describe('Disabled State', () => {
    it('should not open dropdown when disabled', async () => {
      const user = userEvent.setup();
      render(<AIModelSelector {...defaultProps} disabled={true} />);

      await user.click(screen.getByText('Flux Kontext Pro'));

      // Dropdown should not open
      expect(screen.queryByText('Versatile Models')).not.toBeInTheDocument();
    });
  });

  describe('Video Mode', () => {
    it('should show video models when mode is "video"', async () => {
      const user = userEvent.setup();
      render(
        <AIModelSelector {...defaultProps} mode="video" value="video-model-1" />
      );

      expect(screen.getByText('Video Model 1')).toBeInTheDocument();

      await user.click(screen.getByText('Video Model 1'));

      await waitFor(() => {
        expect(screen.getByText('Standard Video')).toBeInTheDocument();
      });
    });

    it('should not show token costs in video mode', async () => {
      const user = userEvent.setup();
      render(
        <AIModelSelector {...defaultProps} mode="video" value="video-model-1" />
      );

      await user.click(screen.getByText('Video Model 1'));

      // Video mode doesn't show token costs
      await waitFor(() => {
        const tokenBadges = screen.queryAllByTestId('token-cost');
        expect(tokenBadges.length).toBe(0);
      });
    });
  });

  describe('Token Cost Display', () => {
    it('should show token cost badge for paid models', async () => {
      const user = userEvent.setup();
      render(<AIModelSelector {...defaultProps} value="flux-pro-1.1" />);

      // Selected model should show token cost
      expect(screen.getByTestId('token-cost')).toHaveTextContent('2 tokens');
    });

    it('should show token costs in dropdown for paid models', async () => {
      const user = userEvent.setup();
      render(<AIModelSelector {...defaultProps} />);

      await user.click(screen.getByText('Flux Kontext Pro'));

      await waitFor(() => {
        // Multiple token badges in dropdown
        const tokenBadges = screen.getAllByTestId('token-cost');
        expect(tokenBadges.length).toBeGreaterThan(0);
      });
    });
  });
});
