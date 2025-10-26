/**
 * Auth Island - React component for authentication UI
 * This creates a "React island" within the vanilla JS image-generator app
 * Uses simplified auth components without heavy dependencies
 */

import { AuthProvider } from '../editor/contexts';
import { Tooltip } from 'radix-ui';
import ProfileButton from './components/ProfileButton.jsx';

/**
 * AuthIsland component - wraps auth UI in AuthProvider
 * ProfileButton manages its own modal state locally
 */
const AuthIsland = () => {
  return (
    <AuthProvider>
      <Tooltip.Provider>
        {/* Profile button that triggers signin or profile modal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ProfileButton />
        </div>
      </Tooltip.Provider>
    </AuthProvider>
  );
};

export default AuthIsland;
