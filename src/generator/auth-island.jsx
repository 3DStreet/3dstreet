/**
 * Auth Island - React component for authentication UI
 * This creates a "React island" within the vanilla JS image-generator app
 * Uses simplified auth components without heavy dependencies
 */

import { AuthProvider } from '../editor/contexts';
import ProfileButton from './components/ProfileButton.jsx';
import TokenSync from './components/TokenSync.jsx';

/**
 * AuthIsland component - wraps auth UI in AuthProvider
 * ProfileButton manages its own modal state locally and includes its own TooltipProvider
 */
const AuthIsland = () => {
  return (
    <AuthProvider>
      {/* Sync token profile to window.authState for vanilla JS */}
      <TokenSync />
      {/* Profile button that triggers signin or profile modal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <ProfileButton />
      </div>
    </AuthProvider>
  );
};

export default AuthIsland;
