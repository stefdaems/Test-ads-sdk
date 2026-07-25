/**
 * Jest globalTeardown — runs once after all test suites.
 * Provides a safety-net that closes any Appium sessions not cleaned up by
 * individual test files (e.g., when a suite crashes mid-test).
 */
export default async function globalTeardown(): Promise<void> {
  // Individual test files own their sessions and call closeDriver() in afterAll.
  // Nothing additional is needed at the global level unless a shared session
  // strategy is adopted in the future.
}
