/**
 * TokenSync - Syncs token profile to window.authState for vanilla JS access
 */
import { useEffect } from 'react';
import { useAuthContext } from '../../editor/contexts';

const TokenSync = () => {
  const { tokenProfile } = useAuthContext();

  useEffect(() => {
    // Update window.authState with tokenProfile
    if (window.authState) {
      window.authState.tokenProfile = tokenProfile;
    }

    // Dispatch event so main.js can update button states
    // Use CustomEvent with detail to match mount-auth.js format
    window.dispatchEvent(
      new CustomEvent('authStateChanged', {
        detail: {
          user: window.authState?.currentUser,
          isAuthenticated: !!window.authState?.currentUser
        }
      })
    );
  }, [tokenProfile]);

  return null; // This component doesn't render anything
};

export default TokenSync;
