// Integration tests run against the Neon `test` branch, never dev.
try {
  process.loadEnvFile();
} catch {
  // CI provides env vars directly
}
if (!process.env.TEST_DATABASE_URL)
  throw new Error("TEST_DATABASE_URL is required for integration tests");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
