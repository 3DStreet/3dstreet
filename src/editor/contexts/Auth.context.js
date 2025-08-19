import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import PropTypes from 'prop-types';
import { isUserPro } from '../api/user';
import { getTokenProfile } from '../utils/tokens';
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
        const tokens = await getTokenProfile(user.uid);
        setTokenProfile(tokens);
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
