import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '@shared/services/firebase';
import PropTypes from 'prop-types';
import { isUserPro } from '@shared/auth/api/user';
import { getTokenProfile, checkAndRefillProTokens } from '@shared/utils/tokens';
import posthog from 'posthog-js';

const AuthContext = createContext({
  currentUser: null,
  setCurrentUser: (user) => {},
  tokenProfile: null,
  refreshTokenProfile: () => {},
  isLoading: true
});

const PRO_STATUS_CACHE_KEY = 'proStatusCache';
const PRO_STATUS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const getCachedProStatus = (uid) => {
  try {
    const cached = JSON.parse(localStorage.getItem(PRO_STATUS_CACHE_KEY));
    if (
      cached &&
      cached.uid === uid &&
      Date.now() - cached.timestamp < PRO_STATUS_CACHE_MAX_AGE_MS
    ) {
      return cached.status;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
};

const setCachedProStatus = (uid, status) => {
  try {
    localStorage.setItem(
      PRO_STATUS_CACHE_KEY,
      JSON.stringify({ uid, status, timestamp: Date.now() })
    );
  } catch {
    // Ignore storage errors
  }
};

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
    // Tracks the currently active user UID (null = logged out).
    // Used to discard stale Phase 2 results when the user logs out
    // or switches accounts while background fetches are in-flight.
    let activeUid = null;

    const fetchUserData = async (user) => {
      if (!user) {
        activeUid = null;
        localStorage.removeItem('token');
        localStorage.removeItem(PRO_STATUS_CACHE_KEY);
        setCurrentUser(null);
        setTokenProfile(null);
        setIsLoading(false);
        return;
      }

      activeUid = user.uid;
      const thisUid = user.uid;

      // Phase 1: Set basic user immediately with cached pro status.
      // This unblocks the UI so components know the user is authenticated
      // without waiting for slow cloud function calls.
      const cachedProStatus = getCachedProStatus(user.uid);
      setCurrentUser({
        ...user,
        isPro: cachedProStatus?.isPro ?? false,
        isProSubscription: cachedProStatus?.isProSubscription ?? false,
        isProDomain: cachedProStatus?.isProDomain ?? false,
        isProTeam: cachedProStatus?.isProDomain ?? false,
        teamDomain: cachedProStatus?.teamDomain ?? null
      });
      setIsLoading(false);

      // Phase 2: Enrich in background - run operations in parallel.
      // Pro status check (cloud function), ID token fetch, and token profile
      // fetch all run concurrently instead of sequentially.
      const [proStatusResult, , tokenProfileResult] = await Promise.allSettled([
        isUserPro(user),
        user.getIdToken().then((token) => {
          localStorage.setItem('token', token);
        }),
        getTokenProfile(user.uid)
      ]);

      // Discard results if user changed (logout or switched accounts)
      if (activeUid !== thisUid) return;

      const proStatus =
        proStatusResult.status === 'fulfilled'
          ? proStatusResult.value
          : {
              isPro: false,
              isProSubscription: false,
              isProDomain: false,
              teamDomain: null
            };

      // Only cache when the cloud function actually succeeded —
      // avoid overwriting a valid cache with a failure fallback
      if (proStatusResult.status === 'fulfilled') {
        setCachedProStatus(user.uid, proStatus);
      }

      const enrichedUser = {
        ...user,
        isPro: proStatus.isPro,
        isProSubscription: proStatus.isProSubscription,
        isProDomain: proStatus.isProDomain,
        isProTeam: proStatus.isProDomain, // Alias for clearer semantics
        teamDomain: proStatus.teamDomain
      };
      setCurrentUser(enrichedUser);

      // Set initial token profile from the parallel fetch
      if (
        tokenProfileResult.status === 'fulfilled' &&
        tokenProfileResult.value
      ) {
        setTokenProfile(tokenProfileResult.value);
      } else if (tokenProfileResult.status === 'rejected') {
        console.error(
          'Error fetching token profile:',
          tokenProfileResult.reason
        );
      }

      // For pro users, check and refill tokens in background (non-blocking)
      if (proStatus.isPro) {
        checkAndRefillProTokens()
          .then((refreshedTokens) => {
            if (activeUid === thisUid && refreshedTokens) {
              setTokenProfile(refreshedTokens);
            }
          })
          .catch((error) => {
            console.error('Error refilling pro tokens:', error);
          });
      }

      // Non-blocking: PostHog identify (doesn't affect auth state)
      posthog.identify(user.uid, {
        email: user.email,
        name: user.displayName,
        isPro: proStatus.isPro,
        isProSubscription: proStatus.isProSubscription,
        isProDomain: proStatus.isProDomain,
        teamDomain: proStatus.teamDomain
      });
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      fetchUserData(user);
    });

    return () => unsubscribe();
  }, []);

  // Listen for token count changes (e.g., after image generation)
  useEffect(() => {
    const handleTokenCountChanged = () => {
      refreshTokenProfile();
    };

    window.addEventListener('tokenCountChanged', handleTokenCountChanged);

    return () => {
      window.removeEventListener('tokenCountChanged', handleTokenCountChanged);
    };
  }, [currentUser]);

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
