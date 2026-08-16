import { describe, it, expect } from 'vitest';
import { formatLocationString } from '../../src/utils.js';

// The geoid cloud function joined street/locality/state/country with
// unconditional commas, so scenes saved before its fix carry strings like
// ", , New York, United States". formatLocationString strips the empty
// segments wherever a location string is displayed or stored.
describe('formatLocationString', () => {
  it('returns a fully-populated string unchanged', () => {
    expect(formatLocationString('Market Street, San Francisco, CA, US')).toBe(
      'Market Street, San Francisco, CA, US'
    );
  });

  it('drops leading empty segments', () => {
    expect(formatLocationString(', , New York, United States')).toBe(
      'New York, United States'
    );
  });

  it('drops interior and trailing empty segments', () => {
    expect(formatLocationString('Broadway, , New York, ')).toBe(
      'Broadway, New York'
    );
  });

  it('normalizes whitespace around segments', () => {
    expect(formatLocationString('  Broadway ,New York  ')).toBe(
      'Broadway, New York'
    );
  });

  it('returns an empty string when every segment is empty', () => {
    expect(formatLocationString(', , , ')).toBe('');
  });

  it('returns an empty string for null, undefined, and empty input', () => {
    expect(formatLocationString(null)).toBe('');
    expect(formatLocationString(undefined)).toBe('');
    expect(formatLocationString('')).toBe('');
  });
});
