/**
 * Storage rules — scene files follow the scene's visibility (#1267).
 *
 * Run via `npm run test:rules` (needs the storage emulator; the rules read
 * the scene doc from the firestore emulator of the same project).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, getMetadata, uploadString } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AUTHOR = 'author-uid';
const OTHER = 'other-uid';

let testEnv;

const fileRef = (ctx, sceneId) =>
  ref(ctx.storage(), `scenes/${sceneId}/files/preview.jpg`);

describe('storage.rules — scenes/{id}/files read', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      // The project the emulators run under (npm run test:rules): storage
      // rules read scene docs from that project's firestore emulator.
      projectId: 'demo-3dstreet-rules',
      firestore: {
        rules: readFileSync(
          resolve(__dirname, '../../public/firestore.rules'),
          'utf8'
        ),
        host: '127.0.0.1',
        port: 8080
      },
      storage: {
        rules: readFileSync(
          resolve(__dirname, '../../public/storage.rules'),
          'utf8'
        ),
        host: '127.0.0.1',
        port: 9199
      }
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      for (const [id, visibility] of [
        ['public-scene', 'public'],
        ['private-scene', 'private']
      ]) {
        await setDoc(doc(ctx.firestore(), 'scenes', id), {
          author: AUTHOR,
          visibility
        });
        // A small image: readable signed out when the scene isn't private.
        await uploadString(fileRef(ctx, id), 'x', 'raw', {
          contentType: 'image/jpeg'
        });
      }
    });
  });

  it("anyone can read a public scene's small image", async () => {
    await assertSucceeds(
      getMetadata(fileRef(testEnv.unauthenticatedContext(), 'public-scene'))
    );
    await assertSucceeds(
      getMetadata(fileRef(testEnv.authenticatedContext(OTHER), 'public-scene'))
    );
  });

  it("only the author can read a private scene's files", async () => {
    await assertSucceeds(
      getMetadata(
        fileRef(testEnv.authenticatedContext(AUTHOR), 'private-scene')
      )
    );
    await assertFails(
      getMetadata(fileRef(testEnv.authenticatedContext(OTHER), 'private-scene'))
    );
    await assertFails(
      getMetadata(fileRef(testEnv.unauthenticatedContext(), 'private-scene'))
    );
  });

  it("only the author can write a scene's files", async () => {
    await assertSucceeds(
      uploadString(
        fileRef(testEnv.authenticatedContext(AUTHOR), 'public-scene'),
        'y',
        'raw',
        { contentType: 'image/jpeg' }
      )
    );
    await assertFails(
      uploadString(
        fileRef(testEnv.authenticatedContext(OTHER), 'public-scene'),
        'y',
        'raw',
        { contentType: 'image/jpeg' }
      )
    );
  });
});
