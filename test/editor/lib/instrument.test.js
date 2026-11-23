import { describe, expect, it } from 'vitest';
import { isFirebaseInternalAbort } from '../../../src/editor/instrument.js';

const event = (type, filenames) => ({
  exception: {
    values: [
      {
        type,
        stacktrace: { frames: filenames.map((filename) => ({ filename })) }
      }
    ]
  }
});

const SENTRY = './node_modules/@sentry/browser/build/npm/esm/prod/helpers.js';
const WEBCHANNEL =
  './node_modules/@firebase/webchannel-wrapper/dist/webchannel-blob/esm/webchannel_blob_es2018.js';
const FIRESTORE = './node_modules/@firebase/firestore/dist/common.esm.js';

describe('isFirebaseInternalAbort', () => {
  it('drops an AbortError thrown entirely inside Firebase', () => {
    expect(
      isFirebaseInternalAbort(
        event('AbortError', [SENTRY, FIRESTORE, WEBCHANNEL])
      )
    ).toBe(true);
  });

  it('keeps an AbortError with a frame from our own code', () => {
    expect(
      isFirebaseInternalAbort(
        event('AbortError', [WEBCHANNEL, './src/editor/api/scene.js'])
      )
    ).toBe(false);
  });

  it('keeps an AbortError with no stack to judge by', () => {
    expect(isFirebaseInternalAbort(event('AbortError', []))).toBe(false);
  });

  it('keeps other errors from Firebase', () => {
    expect(isFirebaseInternalAbort(event('TypeError', [WEBCHANNEL]))).toBe(
      false
    );
  });

  it('keeps events without an exception', () => {
    expect(isFirebaseInternalAbort({ message: 'hi' })).toBe(false);
  });
});
