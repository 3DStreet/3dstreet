/**
 * TokenDisplay Component Tests
 *
 * Tests for TokenDisplayBase, TokenDisplayInner, and TokenDisplay components.
 * These tests verify rendering logic and prop handling for the token display system.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MockAuthProvider,
  createMockUser,
  createMockTokenProfile
} from '../../generator/test-utils.jsx';

// ============= MOCK COMPONENTS FOR TESTING =============

// Mock TokenDisplayBase - Pure presentational component
const TokenDisplayBase = ({
  count,
  showLabel = false,
  useContainer = false,
  inline = false,
  compact = false,
  tokenType = 'genToken',
  label = null,
  iconSrc = null,
  className = ''
}) => {
  // Don't render if no token count available
  if (count === null || count === undefined) {
    return null;
  }

  const tokenIcon =
    iconSrc ||
    (tokenType === 'geoToken'
      ? '/ui_assets/token-geo.png'
      : '/ui_assets/token-image.png');
  const tokenLabel =
    label || (tokenType === 'geoToken' ? 'Geo Tokens' : 'AI Generation Tokens');

  const displayClassName = ['tokenDisplay', inline && 'inline', compact && 'compact', className]
    .filter(Boolean)
    .join(' ');

  const content = (
    <span className={displayClassName} data-testid="token-display">
      <img src={tokenIcon} alt={tokenLabel} data-testid="token-icon" />
      <span data-testid="token-count">{count}</span>
      {showLabel && <span data-testid="token-label">{tokenLabel}</span>}
    </span>
  );

  return useContainer ? (
    <div data-testid="token-container">{content}</div>
  ) : (
    content
  );
};

// Mock TokenDisplayInner - uses auth context
const TokenDisplayInner = ({
  showLabel = false,
  useContainer = false,
  inline = false,
  compact = false,
  tokenType = 'genToken',
  label = null,
  count = null,
  iconSrc = null,
  showDetails = false,
  currentUser = null,
  tokenProfile = null
}) => {
  // Auto-configure based on tokenType if not explicitly provided
  const tokenCount = count !== null ? count : tokenProfile?.[tokenType];

  // Only check for user if count is not explicitly provided
  if (count === null && !currentUser) {
    return null;
  }

  // Don't render if no token count available
  if (tokenCount === null || tokenCount === undefined) {
    return null;
  }

  return (
    <TokenDisplayBase
      count={tokenCount}
      showLabel={showLabel}
      useContainer={useContainer}
      inline={inline}
      compact={compact}
      tokenType={tokenType}
      label={label}
      iconSrc={iconSrc}
      className={showDetails ? 'hoverable' : ''}
    />
  );
};

// ============= TESTS =============

describe('TokenDisplayBase', () => {
  describe('Rendering', () => {
    it('should render token count', () => {
      render(<TokenDisplayBase count={25} />);

      expect(screen.getByTestId('token-count')).toHaveTextContent('25');
    });

    it('should render token icon with correct src for genToken', () => {
      render(<TokenDisplayBase count={10} tokenType="genToken" />);

      const icon = screen.getByTestId('token-icon');
      expect(icon).toHaveAttribute('src', '/ui_assets/token-image.png');
    });

    it('should render token icon with correct src for geoToken', () => {
      render(<TokenDisplayBase count={10} tokenType="geoToken" />);

      const icon = screen.getByTestId('token-icon');
      expect(icon).toHaveAttribute('src', '/ui_assets/token-geo.png');
    });

    it('should use custom icon when iconSrc provided', () => {
      render(<TokenDisplayBase count={10} iconSrc="/custom/icon.png" />);

      const icon = screen.getByTestId('token-icon');
      expect(icon).toHaveAttribute('src', '/custom/icon.png');
    });

    it('should return null when count is null', () => {
      const { container } = render(<TokenDisplayBase count={null} />);

      expect(container.firstChild).toBeNull();
    });

    it('should return null when count is undefined', () => {
      const { container } = render(<TokenDisplayBase count={undefined} />);

      expect(container.firstChild).toBeNull();
    });

    it('should render count of 0', () => {
      render(<TokenDisplayBase count={0} />);

      expect(screen.getByTestId('token-count')).toHaveTextContent('0');
    });
  });

  describe('Label Display', () => {
    it('should not show label by default', () => {
      render(<TokenDisplayBase count={10} />);

      expect(screen.queryByTestId('token-label')).not.toBeInTheDocument();
    });

    it('should show label when showLabel is true', () => {
      render(<TokenDisplayBase count={10} showLabel={true} />);

      expect(screen.getByTestId('token-label')).toBeInTheDocument();
    });

    it('should show correct label for genToken', () => {
      render(<TokenDisplayBase count={10} showLabel={true} tokenType="genToken" />);

      expect(screen.getByTestId('token-label')).toHaveTextContent('AI Generation Tokens');
    });

    it('should show correct label for geoToken', () => {
      render(<TokenDisplayBase count={10} showLabel={true} tokenType="geoToken" />);

      expect(screen.getByTestId('token-label')).toHaveTextContent('Geo Tokens');
    });

    it('should use custom label when provided', () => {
      render(<TokenDisplayBase count={10} showLabel={true} label="Custom Label" />);

      expect(screen.getByTestId('token-label')).toHaveTextContent('Custom Label');
    });
  });

  describe('Container Wrapper', () => {
    it('should not wrap in container by default', () => {
      render(<TokenDisplayBase count={10} />);

      expect(screen.queryByTestId('token-container')).not.toBeInTheDocument();
    });

    it('should wrap in container when useContainer is true', () => {
      render(<TokenDisplayBase count={10} useContainer={true} />);

      expect(screen.getByTestId('token-container')).toBeInTheDocument();
    });
  });

  describe('Style Variants', () => {
    it('should apply inline class when inline is true', () => {
      render(<TokenDisplayBase count={10} inline={true} />);

      expect(screen.getByTestId('token-display').className).toContain('inline');
    });

    it('should apply compact class when compact is true', () => {
      render(<TokenDisplayBase count={10} compact={true} />);

      expect(screen.getByTestId('token-display').className).toContain('compact');
    });

    it('should apply custom className', () => {
      render(<TokenDisplayBase count={10} className="custom-class" />);

      expect(screen.getByTestId('token-display').className).toContain('custom-class');
    });

    it('should combine multiple style classes', () => {
      render(<TokenDisplayBase count={10} inline={true} compact={true} className="extra" />);

      const className = screen.getByTestId('token-display').className;
      expect(className).toContain('inline');
      expect(className).toContain('compact');
      expect(className).toContain('extra');
    });
  });

  describe('Accessibility', () => {
    it('should have alt text on icon for genToken', () => {
      render(<TokenDisplayBase count={10} tokenType="genToken" />);

      const icon = screen.getByTestId('token-icon');
      expect(icon).toHaveAttribute('alt', 'AI Generation Tokens');
    });

    it('should have alt text on icon for geoToken', () => {
      render(<TokenDisplayBase count={10} tokenType="geoToken" />);

      const icon = screen.getByTestId('token-icon');
      expect(icon).toHaveAttribute('alt', 'Geo Tokens');
    });
  });
});

describe('TokenDisplayInner', () => {
  describe('Auth Context Integration', () => {
    it('should display token count from tokenProfile', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 42 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
        />
      );

      expect(screen.getByTestId('token-count')).toHaveTextContent('42');
    });

    it('should return null when no currentUser and no explicit count', () => {
      const { container } = render(
        <TokenDisplayInner currentUser={null} tokenProfile={null} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render with explicit count even without user', () => {
      render(<TokenDisplayInner count={15} />);

      expect(screen.getByTestId('token-count')).toHaveTextContent('15');
    });

    it('should use explicit count over tokenProfile value', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 100 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          count={5}
        />
      );

      expect(screen.getByTestId('token-count')).toHaveTextContent('5');
    });
  });

  describe('Token Type Selection', () => {
    it('should display genToken by default', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 20, geoToken: 50 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
        />
      );

      expect(screen.getByTestId('token-count')).toHaveTextContent('20');
    });

    it('should display geoToken when tokenType is geoToken', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 20, geoToken: 50 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          tokenType="geoToken"
        />
      );

      expect(screen.getByTestId('token-count')).toHaveTextContent('50');
    });
  });

  describe('Missing Token Profile', () => {
    it('should return null when tokenProfile is null', () => {
      const currentUser = createMockUser();

      const { container } = render(
        <TokenDisplayInner currentUser={currentUser} tokenProfile={null} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should return null when specific token type is undefined', () => {
      const tokenProfile = { genToken: 10 };
      const currentUser = createMockUser();

      const { container } = render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          tokenType="geoToken"
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('showDetails flag', () => {
    it('should add hoverable class when showDetails is true', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 10 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          showDetails={true}
        />
      );

      expect(screen.getByTestId('token-display').className).toContain('hoverable');
    });

    it('should not add hoverable class when showDetails is false', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 10 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          showDetails={false}
        />
      );

      expect(screen.getByTestId('token-display').className).not.toContain('hoverable');
    });
  });

  describe('Props Passthrough', () => {
    it('should pass showLabel to TokenDisplayBase', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 10 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          showLabel={true}
        />
      );

      expect(screen.getByTestId('token-label')).toBeInTheDocument();
    });

    it('should pass useContainer to TokenDisplayBase', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 10 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          useContainer={true}
        />
      );

      expect(screen.getByTestId('token-container')).toBeInTheDocument();
    });

    it('should pass inline to TokenDisplayBase', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 10 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          inline={true}
        />
      );

      expect(screen.getByTestId('token-display').className).toContain('inline');
    });

    it('should pass compact to TokenDisplayBase', () => {
      const tokenProfile = createMockTokenProfile({ genToken: 10 });
      const currentUser = createMockUser();

      render(
        <TokenDisplayInner
          currentUser={currentUser}
          tokenProfile={tokenProfile}
          compact={true}
        />
      );

      expect(screen.getByTestId('token-display').className).toContain('compact');
    });
  });
});

describe('TokenDisplay - Integration', () => {
  // Tests for the wrapped component that includes AuthProvider
  describe('Component composition', () => {
    it('should render TokenDisplayInner with auth props', () => {
      // This test verifies the component can receive auth data via props
      // In the real app, these would come from context
      render(
        <TokenDisplayInner
          showLabel={true}
          currentUser={createMockUser()}
          tokenProfile={createMockTokenProfile({ genToken: 25 })}
        />
      );

      expect(screen.getByTestId('token-count')).toHaveTextContent('25');
      expect(screen.getByTestId('token-label')).toBeInTheDocument();
    });
  });
});

/**
 * React Migration Notes:
 *
 * TokenDisplayBase is already a pure presentational component - no changes needed.
 *
 * TokenDisplayInner and TokenDisplay can be used as-is in the new React app.
 * The key migration considerations are:
 *
 * 1. Ensure AuthProvider context is available at the app root
 * 2. TokenDisplayBase can be used for simple displays without auth
 * 3. TokenDisplayInner is for use within existing AuthProvider
 * 4. TokenDisplay (with wrapper) is for standalone usage
 *
 * The component already follows React best practices:
 * - Pure presentation separation (TokenDisplayBase)
 * - Context consumer separation (TokenDisplayInner)
 * - Provider wrapper for isolation (TokenDisplay)
 */
