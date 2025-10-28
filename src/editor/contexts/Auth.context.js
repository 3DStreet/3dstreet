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
  refreshTokenProfile: () => {},
  isLoading: true
});

const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [tokenProfile, setTokenProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

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
        setIsLoading(false);
        return;
      }

      localStorage.setItem('token', await user.getIdToken());

      const proStatus = await isUserPro(user);
      const enrichedUser = {
        ...user,
        isPro: proStatus.isPro,
        isProSubscription: proStatus.isProSubscription,
        isProDomain: proStatus.isProDomain,
        isProTeam: proStatus.isProDomain, // Alias for clearer semantics
        teamDomain: proStatus.teamDomain
      };

      try {
        // For pro users, call the cloud function to check/refill
        if (proStatus.isPro) {
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
        isPro: proStatus.isPro,
        isProSubscription: proStatus.isProSubscription,
        isProDomain: proStatus.isProDomain,
        teamDomain: proStatus.teamDomain
      });

      setCurrentUser(enrichedUser);
      setIsLoading(false);
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      fetchUserData(user);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        tokenProfile,
        refreshTokenProfile,
        isLoading
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired
};

const useAuthContext = () => useContext(AuthContext);

export { AuthProvider, useAuthContext, AuthContext };
