/**
 * A Stripe price ID from its secret. Trimmed: a secret set through a pipe
 * ends with a newline, which would never equal the ID the client sends.
 */
const priceIdFromEnv = (name) => (process.env[name] || '').trim();

module.exports = { priceIdFromEnv };
