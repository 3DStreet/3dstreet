// Simple hash function for consistent string hashing
// To add new words to filter: console.log(simpleHash('word')) and add the result to inappropriateHashes
const simpleHash = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
};

// Hashed inappropriate words (using simpleHash function)
// This avoids storing explicit content in the codebase
const inappropriateHashes = [
  '1t7nz',
  '2im7u',
  'zt6',
  '15u6h',
  '1c6xa',
  '1rvz6',
  '1a17r',
  '1xngu',
  '1fl7g',
  '19n2c',
  '1z50t',
  'pc0',
  'r6u',
  '1562kb',
  '21o6q',
  '2cz2a',
  '1waw6c',
  '1w9zj8',
  '1bd5k'
];

// Common patterns that might indicate inappropriate content
const suspiciousPatterns = [
  /(.+)\1{2,}/, // Repeated characters (e.g., 'xxxx')
  /^[0-9]+$/, // All numbers
  /^[^a-zA-Z0-9_]+$/ // All special characters
];

export const containsProfanity = (text) => {
  const lowerText = text.toLowerCase();

  // Check against hashed inappropriate words
  const words = lowerText.split(/[^a-zA-Z0-9]+/);
  for (const word of words) {
    if (word.length > 2 && inappropriateHashes.includes(simpleHash(word))) {
      return true;
    }
  }

  // Check for suspicious patterns
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(lowerText)) {
      return true;
    }
  }

  return false;
};
