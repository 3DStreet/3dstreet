#!/usr/bin/env node
/**
 * Seed the local Firebase emulators with test users, two teams and a few
 * scenes, for trying things by hand. Run while `npm run emulators` is up:
 *
 *   npm run emulators:seed
 *
 * Only ever talks to the emulators: the emulator host variables are forced
 * below and the project is the demo- one, so it cannot touch a deployed
 * project. Safe to re-run: the users, teams and scenes are recreated with
 * the same ids (other data, like scenes you saved, is left alone).
 *
 * Sign in with the Google button: the emulator's popup lists these users.
 * Each also has the password `password` for scripts.
 */
const { EMULATOR_PROJECT_ID, EMULATOR_HOST, EMULATOR_PORTS } = {
  // Keep in sync with src/shared/utils/emulators.js (an ES module).
  EMULATOR_PROJECT_ID: 'demo-3dstreet',
  EMULATOR_HOST: '127.0.0.1',
  EMULATOR_PORTS: { auth: 9099, firestore: 8080 }
};

process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`;
process.env.FIRESTORE_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORTS.firestore}`;

const admin = require('firebase-admin');

admin.initializeApp({ projectId: EMULATOR_PROJECT_ID });

const PASSWORD = 'password';

// claims: what Stripe (plan) or an admin grant sets on a real account.
const USERS = [
  {
    uid: 'free-user',
    email: 'free@example.test',
    name: 'Free User',
    claims: {}
  },
  {
    uid: 'pro-user',
    email: 'pro@example.test',
    name: 'Pro User',
    claims: { plan: 'PRO' }
  },
  {
    uid: 'max-user',
    email: 'max@example.test',
    name: 'Max User',
    claims: { plan: 'MAX' }
  },
  {
    uid: 'admin-user',
    email: 'admin@example.test',
    name: 'Admin User',
    claims: { plan: 'MAX', admin: true }
  },
  {
    uid: 'viewer-user',
    email: 'viewer@example.test',
    name: 'Viewer User',
    claims: {}
  }
];

// Teams (docs/orgs.md). UO is a class: members edit only their own work,
// people joining with a @uoregon.edu email come in as viewers. LA Metro is
// a department: members edit everything (the default).
const TEAMS = [
  {
    orgId: 'uo-class',
    name: 'UO Urban Design 410',
    plan: 'PRO',
    seats: 25,
    domains: ['uoregon.edu'],
    settings: { memberEditScope: 'own', domainJoinRole: 'viewer' },
    members: {
      'pro-user': 'owner',
      'free-user': 'member',
      'max-user': 'member'
    },
    projects: { studio: 'Studio 1' },
    wallet: { budget: 500, used: {} }
  },
  {
    orgId: 'la-metro',
    name: 'LA Metro',
    plan: 'MAX',
    seats: 5,
    domains: [],
    settings: {},
    members: {
      'pro-user': 'owner',
      'free-user': 'member',
      'viewer-user': 'viewer'
    },
    projects: { tod: '2026 TOD Visuals' },
    wallet: {
      budget: 1500,
      cap: 20,
      used: { 'pro-user': 100, 'free-user': 15 }
    }
  }
];

// Scenes, with fixed ids so their URLs stay the same:
// http://localhost:3333/scenes/<id>
const SCENES = [
  {
    id: '4d0c1a2e-1111-4a5b-9c3d-000000000001',
    title: "Max's corridor",
    author: 'max-user',
    orgId: 'uo-class',
    projectId: 'studio',
    visibility: 'private'
  },
  {
    id: '4d0c1a2e-2222-4a5b-9c3d-000000000002',
    title: "Free's corridor",
    author: 'free-user',
    orgId: 'uo-class',
    projectId: 'studio',
    visibility: 'private'
  },
  {
    id: '5e1f2a3b-0001-4c5d-8e9f-000000000001',
    title: 'Wilshire BRT',
    author: 'pro-user',
    orgId: 'la-metro',
    projectId: 'tod',
    visibility: 'private'
  },
  {
    id: '5e1f2a3b-0002-4c5d-8e9f-000000000002',
    title: 'My private street',
    author: 'pro-user',
    orgId: null,
    visibility: 'private'
  },
  {
    id: '5e1f2a3b-0003-4c5d-8e9f-000000000003',
    title: 'Free street',
    author: 'free-user',
    orgId: null,
    visibility: 'public'
  }
];

async function upsertUser({ uid, email, name, claims }) {
  const auth = admin.auth();
  // The app only offers Google/Microsoft/Apple sign-in. The Auth emulator
  // fakes those popups and lists the accounts linked to that provider, so
  // each user gets a google.com identity: "Sign in with Google" → pick it.
  // Recreated each run (importUsers can't update), which also resets claims.
  await auth.deleteUser(uid).catch((error) => {
    if (error.code !== 'auth/user-not-found') throw error;
  });
  const result = await auth.importUsers([
    {
      uid,
      email,
      displayName: name,
      emailVerified: true,
      customClaims: claims,
      providerData: [
        {
          providerId: 'google.com',
          uid: `google-${uid}`,
          email,
          displayName: name
        }
      ]
    }
  ]);
  if (result.failureCount) throw result.errors[0].error;
  // Email/password too, for scripts and tests that sign in directly.
  await auth.updateUser(uid, { password: PASSWORD });

  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin
    .firestore()
    .doc(`socialProfile/${uid}`)
    .set(
      {
        userId: uid,
        username: uid.replace('-', '_'),
        displayName: name,
        createdAt: now,
        updatedAt: now
      },
      { merge: true }
    );
}

async function seedTeam(team, userOrgs) {
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const org = db.doc(`orgs/${team.orgId}`);
  await org.set({
    name: team.name,
    plan: team.plan,
    seats: team.seats,
    status: 'active',
    domains: team.domains,
    ...team.settings,
    createdAt: now,
    createdBy: 'admin-user',
    updatedAt: now
  });
  for (const member of (await org.collection('members').get()).docs) {
    await member.ref.delete();
  }
  for (const [uid, role] of Object.entries(team.members)) {
    const user = USERS.find((u) => u.uid === uid);
    await org.collection('members').doc(uid).set({
      uid,
      email: user.email,
      displayName: user.name,
      role,
      joinedAt: now,
      invitedBy: null,
      via: 'staff'
    });
    userOrgs[uid] = { ...(userOrgs[uid] || {}), [team.orgId]: role };
  }
  for (const [projectId, name] of Object.entries(team.projects)) {
    await org.collection('projects').doc(projectId).set({
      name,
      createdBy: 'pro-user',
      createdAt: now,
      updatedAt: now
    });
  }
  // The AI wallet (docs/team-wallet.md), already refilled this month.
  const date = new Date();
  const month = `${date.getFullYear()}-${date.getMonth()}`;
  const used = Object.values(team.wallet.used).reduce((a, b) => a + b, 0);
  await db.doc(`orgWallets/${team.orgId}`).set({
    genToken: team.wallet.budget - used,
    monthlyTokenBudget: team.wallet.budget,
    memberMonthlyCap: team.wallet.cap ?? null,
    lastRefill: month,
    updatedAt: now
  });
  await db
    .doc(`orgWallets/${team.orgId}/usage/${month}`)
    .set({ total: used, members: team.wallet.used });
}

// A one-lane street, enough to see the scene load.
const sceneData = (title) => [
  {
    element: 'a-entity',
    id: 'street-container',
    components: { 'data-layer-name': 'Street' },
    children: [
      {
        element: 'a-entity',
        components: {
          'data-layer-name': title,
          'street-segment': 'type: drive-lane; width: 3; length: 60'
        }
      }
    ]
  }
];

async function seedScene({ id, title, author, orgId, projectId, visibility }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin
    .firestore()
    .doc(`scenes/${id}`)
    .set({
      author,
      title,
      orgId,
      ...(orgId && { projectId, revision: 0, editLock: null }),
      visibility,
      version: '1.0',
      data: sceneData(title),
      memory: {},
      createTimestamp: now,
      updateTimestamp: now
    });
}

async function main() {
  for (const user of USERS) {
    await upsertUser(user);
    console.log(`  ${user.email.padEnd(22)} ${JSON.stringify(user.claims)}`);
  }
  const userOrgs = {};
  for (const team of TEAMS) {
    await seedTeam(team, userOrgs);
    console.log(`  team ${team.name}: ${JSON.stringify(team.members)}`);
  }
  // Each user's teams in one doc (docs/orgs.md), with their first team
  // active as joining it would make it (the team switcher); users in no
  // team get none and work in Personal.
  for (const { uid } of USERS) {
    const orgs = userOrgs[uid] || {};
    await admin
      .firestore()
      .doc(`userOrgs/${uid}`)
      .set({ orgs, activeOrgId: Object.keys(orgs)[0] || null });
  }
  for (const scene of SCENES) {
    await seedScene(scene);
    console.log(
      `  scene http://localhost:3333/scenes/${scene.id}  ${scene.title}`
    );
  }
  console.log(
    `\nSeeded ${USERS.length} users, ${TEAMS.length} teams and ${SCENES.length} scenes in ${EMULATOR_PROJECT_ID}; password: ${PASSWORD}`
  );
}

main().catch((error) => {
  console.error(
    'Seeding failed (are the emulators running? npm run emulators):',
    error.message
  );
  process.exit(1);
});
