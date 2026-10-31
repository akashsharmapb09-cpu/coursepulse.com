/**
 * Runs once when the Next.js server starts. Importing the environment module here makes a bad configuration
 * fail the boot (loudly) instead of surfacing later as a confusing runtime error.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { getServerEnv } = await import("@/config/env");
    getServerEnv();
  }
}
