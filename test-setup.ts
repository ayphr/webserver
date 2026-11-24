/**
 * Shared Bun test bootstrap (loaded by both root and server bunfig.toml).
 *
 * Tests must behave the same on a developer machine with a populated .env and
 * in CI, so strip integrations that would otherwise change code paths.
 */
delete process.env.REDIS_URL; // force the in-memory rate-limit/cache fallback
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // expected rate-limit WARN logs are noise in CI

// Note: Bun scopes module mocks per test file and several suites register them
// at module scope. A global `mock.restore()` would break those suites, so mock
// cleanup stays in the files that own the mocks.
