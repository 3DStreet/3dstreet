import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../services/firebase';
import PropTypes from 'prop-types';
import { isUserPro, isUserBeta } from '../api/user';
import posthog from 'posthog-js';

const AuthContext = createContext({
  currentUser: null,
  setCurrentUser: (user) => {}
});

const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const fetchUserData = async (user) => {
      if (!user) {
        localStorage.removeItem('token');
        setCurrentUser(null);
        return;
      }

      localStorage.setItem('token', await user.getIdToken());

      const isPro = await isUserPro(user);
      const isBeta = await isUserBeta(user);
      const enrichedUser = { ...user, isPro, isBeta };

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
    <AuthContext.Provider value={{ currentUser, setCurrentUser }}>
      {children}
    </AuthContext.Provider>
  );
};

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired
};

const useAuthContext = () => useContext(AuthContext);

export { AuthProvider, useAuthContext };
