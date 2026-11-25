import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from '@shared/services/firebase';
import PropTypes from 'prop-types';
import { isUserPro } from '@shared/auth/api/user';
import { MEMBERSHIP_CHANGED_EVENT, membershipFields } from '@shared/api/orgs';
import { getTokenProfile, checkAndRefillProTokens } from '@shared/utils/tokens';
import { detectBrowserLocale } from '@shared/i18n/locales';
import posthog from 'posthog-js';
import {
  billingOrgOf,
  inactiveBillingOrgOf,
  memberAvailable,
  monthKey,
  refillWallet
} from '@shared/utils/teamWallet';

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

const DETECTED_LOCALE_SYNC_KEY = 'detectedLocaleSynced';

// Capture the browser's detected locale onto the user's socialProfile so
// lifecycle emails send in the user's language (#1841,
// public/functions/email/locale.js). `detectedLocale` is the weak automatic
// signal; an explicit View > Language pick writes `locale` (store.js
// setLocale / useProfileLocaleSync) and wins server-side. Fire-and-forget —
// a lost write just means an English email — and localStorage-guarded to one
// write per uid+locale so repeat sign-ins cost nothing.
const syncDetectedLocale = (uid) => {
  try {
    const locale = detectBrowserLocale();
    const marker = `${uid}:${locale}`;
    if (localStorage.getItem(DETECTED_LOCALE_SYNC_KEY) === marker) return;
    setDoc(
      doc(db, 'socialProfile', uid),
      { userId: uid, detectedLocale: locale },
      { merge: true }
    )
      .then(() => localStorage.setItem(DETECTED_LOCALE_SYNC_KEY, marker))
      .catch((error) =>
        console.error('Error saving detected locale to profile:', error)
      );
  } catch (error) {
    console.error('Error saving detected locale to profile:', error);
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
      // A cached pass-only Pro status (#1922) that has since lapsed reads as
      // free immediately rather than waiting for Phase 2 to correct it.
      const cachedPassActive =
        !!cachedProStatus?.isProPass &&
        Date.parse(cachedProStatus?.proUntil) > Date.now();
      const cachedPassLapsed =
        !!cachedProStatus?.isProPass &&
        !cachedPassActive &&
        !cachedProStatus?.plan &&
        !cachedProStatus?.isProTeam;
      setCurrentUser({
        ...user,
        isPro: (cachedProStatus?.isPro ?? false) && !cachedPassLapsed,
        // Backwards compat: caches written before the isProDomain → isProTeam
        // rename will still have isProDomain. Fall back to it once, expires
        // naturally when the cache refreshes.
        isProTeam:
          cachedProStatus?.isProTeam ?? cachedProStatus?.isProDomain ?? false,
        teamDomain: cachedProStatus?.teamDomain ?? null,
        // Paid tier ('PRO' | 'MAX' | null). Caches written before this field
        // existed simply lack it; Phase 2 backfills on the next enrich.
        plan: cachedProStatus?.plan ?? null,
        // Organizations (#1267): see src/shared/auth/api/user.js.
        teamName: cachedProStatus?.teamName ?? null,
        orgPlan: cachedProStatus?.orgPlan ?? null,
        orgs: cachedProStatus?.orgs ?? [],
        activeOrgId: cachedProStatus?.activeOrgId ?? null,
        // One-time pass (#1922). The server re-evaluates expiry in Phase 2;
        // a cached pass that has since lapsed is dropped here already.
        isProPass: cachedPassActive,
        proUntil: cachedProStatus?.proUntil ?? null
      });
      setIsLoading(false);

      // As early as possible after auth: the welcome email trigger polls
      // briefly for this signal on brand-new accounts (email/locale.js).
      syncDetectedLocale(user.uid);

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
              isProTeam: false,
              teamDomain: null,
              teamName: null,
              plan: null,
              orgPlan: null,
              orgs: [],
              activeOrgId: null,
              isProPass: false,
              proUntil: null
            };

      // Only cache when the cloud function actually succeeded —
      // avoid overwriting a valid cache with a failure fallback
      if (proStatusResult.status === 'fulfilled') {
        setCachedProStatus(user.uid, proStatus);
      }

      const enrichedUser = {
        ...user,
        isPro: proStatus.isPro,
        isProTeam: proStatus.isProTeam,
        teamDomain: proStatus.teamDomain,
        plan: proStatus.plan ?? null,
        teamName: proStatus.teamName ?? null,
        orgPlan: proStatus.orgPlan ?? null,
        orgs: proStatus.orgs ?? [],
        activeOrgId: proStatus.activeOrgId ?? null,
        isProPass: !!proStatus.isProPass,
        proUntil: proStatus.proUntil ?? null
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
        isProTeam: proStatus.isProTeam,
        teamDomain: proStatus.teamDomain,
        isProPass: !!proStatus.isProPass
      });
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      fetchUserData(user);
    });

    return () => unsubscribe();
  }, []);

  // Team AI token wallet (#1267 Phase 3): while a team pays the user's
  // generations, follow its wallet and this month's usage.
  // The team paying the user's generations: their active team, when they
  // hold a seat in it and it's active (the server checks the same).
  const billingOrgId = billingOrgOf(currentUser);
  const inactiveOrgId = inactiveBillingOrgOf(currentUser);
  const uid = currentUser?.uid || null;
  const [teamWallet, setTeamWallet] = useState(null);
  useEffect(() => {
    setTeamWallet(null);
    if (!billingOrgId || !uid) return undefined;
    let wallet = null;
    let usage = null;
    const update = () =>
      wallet && setTeamWallet({ orgId: billingOrgId, wallet, usage });
    const onError = (error) =>
      console.error('Error following the team wallet:', error);
    const unsubscribeWallet = onSnapshot(
      doc(db, 'orgWallets', billingOrgId),
      (snapshot) => {
        wallet = snapshot.data() || {};
        update();
      },
      onError
    );
    const unsubscribeUsage = onSnapshot(
      doc(db, 'orgWallets', billingOrgId, 'usage', monthKey()),
      (snapshot) => {
        usage = snapshot.data() || {};
        update();
      },
      onError
    );
    return () => {
      unsubscribeWallet();
      unsubscribeUsage();
    };
  }, [billingOrgId, uid]);

  // What the app shows and checks before a generation: the team's wallet
  // when it pays (genToken = what this member can still spend from it; the
  // personal balance stays in personalGenToken), else the user's own tokens.
  const effectiveTokenProfile = useMemo(() => {
    if (inactiveOrgId) {
      const team = (currentUser?.orgs || []).find(
        (org) => org.orgId === inactiveOrgId
      );
      return {
        ...(tokenProfile || {}),
        genToken: 0,
        personalGenToken: tokenProfile?.genToken ?? 0,
        billing: {
          orgId: inactiveOrgId,
          teamName: team?.name || null,
          role: team?.role || null,
          inactive: true,
          balance: 0,
          monthlyTokenBudget: 0,
          memberMonthlyCap: null,
          usedThisMonth: 0
        }
      };
    }
    if (!teamWallet || teamWallet.orgId !== billingOrgId) return tokenProfile;
    const wallet = refillWallet(teamWallet.wallet);
    const usedThisMonth = teamWallet.usage?.members?.[uid] || 0;
    const team = (currentUser?.orgs || []).find(
      (org) => org.orgId === billingOrgId
    );
    return {
      ...(tokenProfile || {}),
      genToken: memberAvailable({ wallet, usedThisMonth }),
      personalGenToken: tokenProfile?.genToken ?? 0,
      billing: {
        orgId: billingOrgId,
        teamName: team?.name || null,
        role: team?.role || null,
        balance: wallet.genToken || 0,
        monthlyTokenBudget: wallet.monthlyTokenBudget || 0,
        memberMonthlyCap: wallet.memberMonthlyCap ?? null,
        usedThisMonth
      }
    };
  }, [
    teamWallet,
    tokenProfile,
    billingOrgId,
    inactiveOrgId,
    uid,
    currentUser?.orgs
  ]);

  // A membership change made in another auth context on the page (the
  // team switcher in the profile menu, while the generator's token counter
  // is its own React root): apply it here too, and keep the cache current
  // so a reload doesn't show the previous team first.
  useEffect(() => {
    const apply = (event) => {
      const { uid: changedUid, status } = event.detail || {};
      if (!status || !changedUid) return;
      setCachedProStatus(changedUid, status);
      setCurrentUser((prev) =>
        prev?.uid === changedUid
          ? { ...prev, ...membershipFields(status) }
          : prev
      );
    };
    window.addEventListener(MEMBERSHIP_CHANGED_EVENT, apply);
    return () => window.removeEventListener(MEMBERSHIP_CHANGED_EVENT, apply);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        tokenProfile: effectiveTokenProfile,
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
