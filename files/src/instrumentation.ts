export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    const { getServerEnv } = await import("@/config/env");
    getServerEnv();
  }
}
