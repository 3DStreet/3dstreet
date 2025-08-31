import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import PropTypes from 'prop-types';
import { isUserPro } from '../api/user';
import { getTokenProfile, checkAndRefillProTokens } from '../utils/tokens';
import posthog from 'posthog-js';

const AuthContext = createContext({
  currentUser: null,
  setCurrentUser: (user) => {},
  tokenProfile: null,
  refreshTokenProfile: () => {}
});

const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [tokenProfile, setTokenProfile] = useState(null);

  const refreshTokenProfile = async () => {
    if (currentUser) {
      try {
        // For pro users, call the cloud function to check/refill
        if (currentUser.isPro) {
          const refreshedTokens = await checkAndRefillProTokens();
          if (refreshedTokens) {
            setTokenProfile(refreshedTokens);
            return;
          }
        }

        // For all users (or if cloud function fails), fetch current tokens
        const tokens = await getTokenProfile(currentUser.uid);
        setTokenProfile(tokens);
      } catch (error) {
        console.error('Error refreshing token profile:', error);
      }
    }
  };

  useEffect(() => {
    const fetchUserData = async (user) => {
      if (!user) {
        localStorage.removeItem('token');
        setCurrentUser(null);
        setTokenProfile(null);
        return;
      }

      localStorage.setItem('token', await user.getIdToken());

      const isPro = await isUserPro(user);
      const enrichedUser = { ...user, isPro };

      try {
        // For pro users, call the cloud function to check/refill
        if (isPro) {
          const refreshedTokens = await checkAndRefillProTokens();
          if (refreshedTokens) {
            setTokenProfile(refreshedTokens);
          } else {
            // Fall back to fetching current tokens
            const tokens = await getTokenProfile(user.uid);
            setTokenProfile(tokens);
          }
        } else {
          // For non-pro users, just fetch current tokens
          const tokens = await getTokenProfile(user.uid);
          setTokenProfile(tokens);
        }
      } catch (error) {
        console.error('Error fetching token profile:', error);
      }

      posthog.identify(user.uid, {
        email: user.email,
        name: user.displayName,
        isPro: isPro
      });

      setCurrentUser(enrichedUser);
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      fetchUserData(user);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{ currentUser, setCurrentUser, tokenProfile, refreshTokenProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
};

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired
};

const useAuthContext = () => useContext(AuthContext);

export { AuthProvider, useAuthContext };
