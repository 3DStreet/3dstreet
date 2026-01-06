/**
 * UI Utilities Tests
 *
 * Tests for timer/progress calculations and tab management utilities
 * that will be extracted for React migration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============= EXTRACTABLE PURE FUNCTIONS =============

/**
 * Calculate progress percentage for timer display
 * @param {number} elapsedMs - Elapsed time in milliseconds
 * @param {number} estimatedMs - Estimated total time in milliseconds
 * @returns {{ percentage: number, isOvertime: boolean, overtimeSeconds: number }}
 */
const calculateProgress = (elapsedMs, estimatedMs) => {
  const elapsedSeconds = elapsedMs / 1000;
  const estimatedSeconds = estimatedMs / 1000;

  // Cap at 100%
  const percentage = Math.min((elapsedSeconds / estimatedSeconds) * 100, 100);

  // Overtime is when elapsed > estimated + 10 seconds
  const overtimeThreshold = 10;
  const isOvertime = elapsedSeconds > estimatedSeconds + overtimeThreshold;
  const overtimeSeconds = isOvertime
    ? elapsedSeconds - estimatedSeconds
    : 0;

  return {
    percentage: Math.round(percentage * 10) / 10, // Round to 1 decimal
    isOvertime,
    overtimeSeconds: Math.round(overtimeSeconds)
  };
};

/**
 * Format elapsed time for display
 * @param {number} elapsedMs - Elapsed time in milliseconds
 * @returns {string} Formatted time string (e.g., "1:23")
 */
const formatElapsedTime = (elapsedMs) => {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Get estimated time for a model
 * @param {string} model - Model identifier
 * @param {Object} modelConfig - Model configuration object
 * @returns {number} Estimated time in seconds
 */
const getEstimatedTime = (model, modelConfig = {}) => {
  // Check model-specific config first
  if (modelConfig[model]?.estimatedTime) {
    return modelConfig[model].estimatedTime;
  }

  // Default estimates by model family
  const defaultEstimates = {
    'flux-pro-1.1-ultra': 20,
    'flux-pro-1.1': 15,
    'flux-pro': 20,
    'flux-dev': 25,
    'flux-kontext-pro': 10,
    'flux-kontext-max': 15,
    'flux-schnell': 5
  };

  return defaultEstimates[model] || 15;
};

/**
 * Parse URL hash for tab routing
 * @param {string} hash - URL hash (with or without #)
 * @returns {{ tabId: string, isValid: boolean }}
 */
const parseTabHash = (hash) => {
  // Remove # if present
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;

  if (!cleanHash) {
    return { tabId: null, isValid: false };
  }

  // Add -tab suffix if not present
  const tabId = cleanHash.includes('-tab') ? cleanHash : `${cleanHash}-tab`;

  // Valid tab IDs
  const validTabs = [
    'modify-tab',
    'create-tab',
    'inpaint-tab',
    'outpaint-tab',
    'video-tab'
  ];

  return {
    tabId,
    isValid: validTabs.includes(tabId)
  };
};

/**
 * Generate clean URL hash from tab ID
 * @param {string} tabId - Tab identifier (e.g., "modify-tab")
 * @returns {string} Clean hash (e.g., "modify")
 */
const generateTabHash = (tabId) => {
  return tabId.replace('-tab', '');
};

/**
 * Get notification styling based on type
 * @param {'success' | 'warning' | 'error'} type - Notification type
 * @returns {{ bgClass: string, iconPath: string }}
 */
const getNotificationStyle = (type) => {
  const styles = {
    success: {
      bgClass: 'bg-green-500',
      iconPath:
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />'
    },
    warning: {
      bgClass: 'bg-yellow-500',
      iconPath:
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />'
    },
    error: {
      bgClass: 'bg-red-500',
      iconPath:
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />'
    }
  };

  return styles[type] || styles.error;
};

/**
 * Determine if generate button should show low-token warning
 * @param {Object} authState - Auth state object
 * @returns {{ hasTokens: boolean, showWarning: boolean }}
 */
const getButtonTokenState = (authState) => {
  const isAuthenticated = authState?.isAuthenticated ?? false;
  const genTokens = authState?.tokenProfile?.genToken ?? 0;

  const hasTokens = isAuthenticated && genTokens > 0;
  const showWarning = isAuthenticated && genTokens <= 0;

  return { hasTokens, showWarning };
};

/**
 * Check if pending gallery item is still valid (within 10 second window)
 * @param {Object} pendingItem - Item from localStorage
 * @returns {boolean}
 */
const isPendingGalleryItemValid = (pendingItem) => {
  if (!pendingItem || !pendingItem.timestamp) {
    return false;
  }

  const maxAge = 10000; // 10 seconds
  return Date.now() - pendingItem.timestamp < maxAge;
};

// ============= TESTS =============

describe('Timer/Progress Calculations', () => {
  describe('calculateProgress()', () => {
    it('should return 0% at start', () => {
      const result = calculateProgress(0, 15000);

      expect(result.percentage).toBe(0);
      expect(result.isOvertime).toBe(false);
    });

    it('should return 50% at half time', () => {
      const result = calculateProgress(7500, 15000);

      expect(result.percentage).toBe(50);
      expect(result.isOvertime).toBe(false);
    });

    it('should return 100% at completion', () => {
      const result = calculateProgress(15000, 15000);

      expect(result.percentage).toBe(100);
      expect(result.isOvertime).toBe(false);
    });

    it('should cap at 100% when over estimated time', () => {
      const result = calculateProgress(20000, 15000);

      expect(result.percentage).toBe(100);
    });

    it('should not be overtime until 10 seconds past estimated', () => {
      // 15 seconds estimated, 20 seconds elapsed = 5 seconds over
      const result = calculateProgress(20000, 15000);

      expect(result.isOvertime).toBe(false);
    });

    it('should be overtime after 10+ seconds past estimated', () => {
      // 15 seconds estimated, 30 seconds elapsed = 15 seconds over
      const result = calculateProgress(30000, 15000);

      expect(result.isOvertime).toBe(true);
      expect(result.overtimeSeconds).toBe(15);
    });

    it('should round percentage to 1 decimal', () => {
      // 33.333...% should round
      const result = calculateProgress(5000, 15000);

      expect(result.percentage).toBe(33.3);
    });
  });

  describe('formatElapsedTime()', () => {
    it('should format 0 seconds', () => {
      expect(formatElapsedTime(0)).toBe('0:00');
    });

    it('should format seconds with padding', () => {
      expect(formatElapsedTime(5000)).toBe('0:05');
    });

    it('should format 1 minute', () => {
      expect(formatElapsedTime(60000)).toBe('1:00');
    });

    it('should format mixed minutes and seconds', () => {
      expect(formatElapsedTime(83000)).toBe('1:23');
    });

    it('should format multi-digit minutes', () => {
      expect(formatElapsedTime(185000)).toBe('3:05');
    });

    it('should floor partial seconds', () => {
      expect(formatElapsedTime(5500)).toBe('0:05');
    });
  });

  describe('getEstimatedTime()', () => {
    it('should return model-specific time from config', () => {
      const config = {
        'flux-pro': { estimatedTime: 30 }
      };

      expect(getEstimatedTime('flux-pro', config)).toBe(30);
    });

    it('should return default time for known models', () => {
      expect(getEstimatedTime('flux-pro-1.1-ultra')).toBe(20);
      expect(getEstimatedTime('flux-schnell')).toBe(5);
    });

    it('should return fallback for unknown models', () => {
      expect(getEstimatedTime('unknown-model')).toBe(15);
    });
  });
});

describe('Tab Management', () => {
  describe('parseTabHash()', () => {
    it('should parse hash without # symbol', () => {
      const result = parseTabHash('modify');

      expect(result.tabId).toBe('modify-tab');
      expect(result.isValid).toBe(true);
    });

    it('should parse hash with # symbol', () => {
      const result = parseTabHash('#create');

      expect(result.tabId).toBe('create-tab');
      expect(result.isValid).toBe(true);
    });

    it('should handle hash already containing -tab', () => {
      const result = parseTabHash('inpaint-tab');

      expect(result.tabId).toBe('inpaint-tab');
      expect(result.isValid).toBe(true);
    });

    it('should return invalid for empty hash', () => {
      const result = parseTabHash('');

      expect(result.tabId).toBeNull();
      expect(result.isValid).toBe(false);
    });

    it('should return invalid for unknown tab', () => {
      const result = parseTabHash('unknown');

      expect(result.tabId).toBe('unknown-tab');
      expect(result.isValid).toBe(false);
    });

    it('should recognize all valid tabs', () => {
      const validHashes = ['modify', 'create', 'inpaint', 'outpaint', 'video'];

      validHashes.forEach((hash) => {
        const result = parseTabHash(hash);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('generateTabHash()', () => {
    it('should remove -tab suffix', () => {
      expect(generateTabHash('modify-tab')).toBe('modify');
    });

    it('should handle string without -tab suffix', () => {
      expect(generateTabHash('modify')).toBe('modify');
    });
  });
});

describe('Notification Styling', () => {
  describe('getNotificationStyle()', () => {
    it('should return green for success', () => {
      const style = getNotificationStyle('success');

      expect(style.bgClass).toBe('bg-green-500');
      expect(style.iconPath).toContain('M5 13l4 4L19 7');
    });

    it('should return yellow for warning', () => {
      const style = getNotificationStyle('warning');

      expect(style.bgClass).toBe('bg-yellow-500');
    });

    it('should return red for error', () => {
      const style = getNotificationStyle('error');

      expect(style.bgClass).toBe('bg-red-500');
    });

    it('should default to error for unknown type', () => {
      const style = getNotificationStyle('unknown');

      expect(style.bgClass).toBe('bg-red-500');
    });
  });
});

describe('Button State', () => {
  describe('getButtonTokenState()', () => {
    it('should return hasTokens: true when authenticated with tokens', () => {
      const result = getButtonTokenState({
        isAuthenticated: true,
        tokenProfile: { genToken: 10 }
      });

      expect(result.hasTokens).toBe(true);
      expect(result.showWarning).toBe(false);
    });

    it('should return showWarning when authenticated with no tokens', () => {
      const result = getButtonTokenState({
        isAuthenticated: true,
        tokenProfile: { genToken: 0 }
      });

      expect(result.hasTokens).toBe(false);
      expect(result.showWarning).toBe(true);
    });

    it('should return false for both when not authenticated', () => {
      const result = getButtonTokenState({
        isAuthenticated: false,
        tokenProfile: null
      });

      expect(result.hasTokens).toBe(false);
      expect(result.showWarning).toBe(false);
    });

    it('should handle null authState', () => {
      const result = getButtonTokenState(null);

      expect(result.hasTokens).toBe(false);
      expect(result.showWarning).toBe(false);
    });

    it('should handle missing tokenProfile', () => {
      const result = getButtonTokenState({
        isAuthenticated: true
      });

      expect(result.hasTokens).toBe(false);
      expect(result.showWarning).toBe(true);
    });
  });
});

describe('Gallery Utils', () => {
  describe('isPendingGalleryItemValid()', () => {
    it('should return true for recent item', () => {
      const item = { timestamp: Date.now() - 5000 }; // 5 seconds ago

      expect(isPendingGalleryItemValid(item)).toBe(true);
    });

    it('should return false for old item', () => {
      const item = { timestamp: Date.now() - 15000 }; // 15 seconds ago

      expect(isPendingGalleryItemValid(item)).toBe(false);
    });

    it('should return false for item exactly at threshold', () => {
      const item = { timestamp: Date.now() - 10000 }; // Exactly 10 seconds

      expect(isPendingGalleryItemValid(item)).toBe(false);
    });

    it('should return false for null item', () => {
      expect(isPendingGalleryItemValid(null)).toBe(false);
    });

    it('should return false for item without timestamp', () => {
      expect(isPendingGalleryItemValid({})).toBe(false);
    });
  });
});

/**
 * React Migration Notes:
 *
 * These utilities can be extracted into custom hooks:
 *
 * // useProgress.js
 * const useProgress = (estimatedMs) => {
 *   const [startTime] = useState(Date.now);
 *   const [progress, setProgress] = useState(0);
 *
 *   useEffect(() => {
 *     const interval = setInterval(() => {
 *       const elapsed = Date.now() - startTime;
 *       const { percentage, isOvertime } = calculateProgress(elapsed, estimatedMs);
 *       setProgress({ percentage, isOvertime, elapsed: formatElapsedTime(elapsed) });
 *     }, 100);
 *     return () => clearInterval(interval);
 *   }, [startTime, estimatedMs]);
 *
 *   return progress;
 * };
 *
 * // useTabRouter.js
 * const useTabRouter = () => {
 *   const [activeTab, setActiveTab] = useState(() => {
 *     const { tabId, isValid } = parseTabHash(window.location.hash);
 *     return isValid ? tabId : 'modify-tab';
 *   });
 *
 *   const navigateToTab = useCallback((tabId) => {
 *     window.location.hash = generateTabHash(tabId);
 *     setActiveTab(tabId);
 *   }, []);
 *
 *   return { activeTab, navigateToTab };
 * };
 */
