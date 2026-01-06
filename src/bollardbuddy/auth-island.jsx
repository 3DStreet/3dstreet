/**
 * AuthIsland component - wraps auth UI in AuthProvider
 * ProfileButton manages its own modal state locally
 */

import { AuthProvider } from '../editor/contexts';
import ProfileButton from './components/ProfileButton.jsx';

const AuthIsland = () => {
  return (
    <AuthProvider>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <ProfileButton />
      </div>
    </AuthProvider>
  );
};

export default AuthIsland;
