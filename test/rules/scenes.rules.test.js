/**
 * Firestore rules — scene visibility (#1267, docs/scene-visibility.md).
 *
 * Run via `npm run test:rules`.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  deleteField
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AUTHOR = 'author-uid';
const OTHER = 'other-uid';

let testEnv;

const authorDb = () => testEnv.authenticatedContext(AUTHOR).firestore();
const otherDb = () => testEnv.authenticatedContext(OTHER).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();
const sceneRef = (db, id) => doc(db, 'scenes', id);

const scene = (extra = {}) => ({
  author: AUTHOR,
  title: 'A scene',
  data: [],
  updateTimestamp: new Date('2026-11-01'),
  ...extra
});

async function seed(id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(sceneRef(ctx.firestore(), id), data);
  });
}

describe('firestore.rules — scenes visibility', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-3dstreet-rules-scenes',
      firestore: {
        rules: readFileSync(
          resolve(__dirname, '../../public/firestore.rules'),
          'utf8'
        ),
        host: '127.0.0.1',
        port: 8080
      }
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed('legacy', scene()); // no visibility field: public
    await seed('public', scene({ visibility: 'public' }));
    await seed('unlisted', scene({ visibility: 'unlisted' }));
    await seed('private', scene({ visibility: 'private' }));
  });

  describe('get', () => {
    it('anyone can open legacy, public and unlisted scenes', async () => {
      for (const id of ['legacy', 'public', 'unlisted']) {
        await assertSucceeds(getDoc(sceneRef(anonDb(), id)));
        await assertSucceeds(getDoc(sceneRef(otherDb(), id)));
      }
    });

    it('only the author can open a private scene', async () => {
      await assertSucceeds(getDoc(sceneRef(authorDb(), 'private')));
      await assertFails(getDoc(sceneRef(otherDb(), 'private')));
      await assertFails(getDoc(sceneRef(anonDb(), 'private')));
    });
  });

  describe('list', () => {
    it('the community feed query (visibility == public) is allowed and excludes the others', async () => {
      const snapshot = await assertSucceeds(
        getDocs(
          query(
            collection(anonDb(), 'scenes'),
            where('visibility', '==', 'public'),
            orderBy('updateTimestamp', 'desc')
          )
        )
      );
      const ids = snapshot.docs.map((d) => d.id);
      if (ids.join() !== 'public') throw new Error(`got ${ids}`);
    });

    it('an unfiltered query is refused', async () => {
      await assertFails(getDocs(collection(anonDb(), 'scenes')));
      await assertFails(getDocs(collection(otherDb(), 'scenes')));
    });

    it('the author lists all their own scenes, private included', async () => {
      const snapshot = await assertSucceeds(
        getDocs(
          query(collection(authorDb(), 'scenes'), where('author', '==', AUTHOR))
        )
      );
      if (snapshot.size !== 4) throw new Error(`got ${snapshot.size}`);
    });

    it("listing someone else's scenes by author is refused", async () => {
      await assertFails(
        getDocs(
          query(collection(otherDb(), 'scenes'), where('author', '==', AUTHOR))
        )
      );
    });
  });

  describe('create', () => {
    it('a signed-in user creates a public or unlisted scene as its author', async () => {
      await assertSucceeds(
        setDoc(sceneRef(otherDb(), 'n1'), { author: OTHER })
      );
      await assertSucceeds(
        setDoc(sceneRef(otherDb(), 'n2'), {
          author: OTHER,
          visibility: 'public'
        })
      );
      await assertSucceeds(
        setDoc(sceneRef(otherDb(), 'n3'), {
          author: OTHER,
          visibility: 'unlisted'
        })
      );
    });

    it('cannot create a private scene directly (Pro, through the callable)', async () => {
      await assertFails(
        setDoc(sceneRef(otherDb(), 'n4'), {
          author: OTHER,
          visibility: 'private'
        })
      );
    });

    it('cannot create a scene in someone else’s name', async () => {
      await assertFails(setDoc(sceneRef(otherDb(), 'n5'), { author: AUTHOR }));
    });

    it('cannot create a scene signed out', async () => {
      await assertFails(setDoc(sceneRef(anonDb(), 'n6'), { author: AUTHOR }));
    });

    it('rejects an unknown visibility value', async () => {
      await assertFails(
        setDoc(sceneRef(otherDb(), 'n7'), {
          author: OTHER,
          visibility: 'secret'
        })
      );
    });
  });

  describe('update', () => {
    it('the author saves a private scene without touching visibility', async () => {
      await assertSucceeds(
        updateDoc(sceneRef(authorDb(), 'private'), { title: 'Renamed' })
      );
    });

    it('the author lowers a private scene to unlisted or public', async () => {
      await assertSucceeds(
        updateDoc(sceneRef(authorDb(), 'private'), { visibility: 'unlisted' })
      );
      await assertSucceeds(
        updateDoc(sceneRef(authorDb(), 'unlisted'), { visibility: 'public' })
      );
    });

    it('the author cannot make a scene private directly', async () => {
      await assertFails(
        updateDoc(sceneRef(authorDb(), 'public'), { visibility: 'private' })
      );
      await assertFails(
        updateDoc(sceneRef(authorDb(), 'legacy'), { visibility: 'private' })
      );
    });

    it('the author cannot give the scene away', async () => {
      await assertFails(
        updateDoc(sceneRef(authorDb(), 'public'), { author: OTHER })
      );
      await assertFails(
        updateDoc(sceneRef(authorDb(), 'public'), { author: deleteField() })
      );
    });

    it('nobody else can update a scene', async () => {
      await assertFails(
        updateDoc(sceneRef(otherDb(), 'public'), { title: 'Hijacked' })
      );
      await assertFails(
        updateDoc(sceneRef(anonDb(), 'public'), { title: 'Hijacked' })
      );
    });
  });

  describe('delete', () => {
    it('only the author deletes', async () => {
      await assertFails(deleteDoc(sceneRef(otherDb(), 'private')));
      await assertSucceeds(deleteDoc(sceneRef(authorDb(), 'private')));
    });
  });
});
