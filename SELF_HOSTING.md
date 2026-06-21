# Self-Hosting & Forking 3DStreet

3DStreet is open source (code under **AGPL-3.0**), and we welcome people
forking it, experimenting, and running their own deployments. This guide
explains what to expect when you host 3DStreet on your own domain, which
features need their own backend, and how to do it cleanly so your users have a
good (and safe) experience.

> **TL;DR:** The editor and local scene editing work anywhere. Everything that
> talks to the cloud — sign-in, saving to the cloud, AI generation, geocoding,
> uploads, and payments — is wired to **3DStreet's own Firebase project** and
> will **not** work on another domain unless you stand up your own backend.

## What works out of the box on any domain

- Loading the editor and viewer
- Creating and editing scenes locally
- Street templates and procedural generation
- Importing from Streetmix / StreetPlan URLs
- Loading public scenes and the shared asset library

## What needs your own backend (won't work pointed at ours)

These depend on the official Firebase project (`3dstreet.app`) and its
configured providers, and they will fail on a non-official domain:

| Feature | Why it fails on a fork |
| --- | --- |
| **Sign-in (Google / Microsoft / Apple)** | OAuth only completes on domains in the Firebase project's *Authorized domains* list. Your domain isn't in ours, so sign-in throws `auth/unauthorized-domain`. |
| **Saving scenes to the cloud** | Requires an authenticated user (see above). |
| **AI image / video / splat generation** | Callable Cloud Functions; require auth and spend tokens against our project. |
| **Geocoding / elevation** | Callable Cloud Function backed by our paid Google Maps key. |
| **Asset upload & quota** | Auth + Storage rules scoped to our project. |
| **Payments / PRO upgrade** | Wired to **3DStreet's** Stripe account. Do **not** ship our keys to your users. |

When 3DStreet detects it is running on a non-official domain, it shows a
non-blocking banner telling users that local editing works but cloud features
are unavailable, and sign-in errors explain the same thing. This is by design —
it prevents your users from mistaking expected behavior for a bug.

## Running a full deployment (your own backend)

To run a fully functional instance, point the app at infrastructure you
control:

1. **Create your own Firebase project** (Auth, Firestore, Storage, Functions,
   Hosting).
2. **Provide your own config** — copy `config/.env.template` to
   `config/.env.production` and fill in *your* project's values. Do **not** use
   the committed 3DStreet values; they target our production backend.
3. **Set your own provider credentials:** OAuth client IDs (and add your domain
   to *Authorized domains* in the Firebase console), your own Stripe account and
   price IDs, your own AI provider keys (fal.ai / Replicate) as Cloud Functions
   secrets, your own Google Maps key, etc.
4. **Deploy the Cloud Functions** from `public/functions/` to your project (the
   client calls them by name, so they must exist in your project).
5. **Host the assets** yourself or accept that they load from
   `assets.3dstreet.app` (those models are **CC BY-NC 4.0** — non-commercial).
6. **Suppress the unofficial-build banner** for your own domain by setting
   `OFFICIAL_DEPLOYMENT_HOSTNAMES=yourdomain.com` in your env (comma-separated
   for multiple).

### App Check

For a public deployment, consider guarding your backend against resource abuse
(a fork copying your web config to spend your project's paid resources). This
build supports [Firebase App Check](https://firebase.google.com/docs/app-check)
for that, but any equivalent measure works.

The relevant settings: `FIREBASE_APP_CHECK_SITE_KEY` (a reCAPTCHA Enterprise
site key for your domain) and `FIREBASE_APP_CHECK_DEBUG_TOKEN` for local dev on
the client, plus `APP_CHECK_ENFORCE=true` on the functions once your clients are
sending tokens. Both default to off; see `config/.env.template` and
`public/functions/app-check.js`.

## A note on the 3DStreet name and logo (trademark)

The AGPL-3.0 license covers the **code**. It does **not** grant rights to the
**"3DStreet" name, logo, or branding**, and the bundled 3D assets are licensed
separately (**CC BY-NC 4.0**, non-commercial).

If you run a public fork, please:

- **Rebrand** your deployment so it's clearly distinct from official 3DStreet,
  and don't imply official affiliation or endorsement.
- **Don't reuse** 3DStreet's logos or the "3DStreet" name as your product name.
- **Keep AGPL obligations:** make your modified source available to your users.

This protects your users from confusion about who operates the service and who
to contact for support, privacy, or billing.

## Questions

Open an issue or reach out on [Discord](https://discord.com/invite/zNFMhTwKSd).
We're happy to help people building on 3DStreet.
