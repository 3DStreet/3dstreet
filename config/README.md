For development you'll need a file `.env.development` in this directory.

For production deployment you'll need a file `.env.production` in this directory.

These files should NOT be committed to the repo and will be git ignored.

You have 2 options to generate these files:
* use .env.template to create your own .env.development and .env.production with GCP / Firebase keys generated on your own
* or copy these .env files from GCP Secrets for the appropriate project / environment