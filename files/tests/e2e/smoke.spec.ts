import { expect, test } from "@playwright/test";

test("home page renders exactly one h1 and never scrolls horizontally", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("h1")).toHaveCount(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("pages carry a nonce-based CSP and baseline security headers; framework is not advertised", async ({
  page,
}) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]{22,}'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("health endpoint reveals nothing but status", async ({ request }) => {
  const response = await request.get("/api/v1/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok" });
});

for (const path of [
  "/admin",
  "/admin/users",
  "/student/dashboard",
  "/instructor/analytics",
  "/login",
  "/activate",
  "/api/v1/me",
]) {
  test(`private area ${path} is never indexable or cacheable`, async ({
    request,
  }) => {
    const response = await request.get(path);
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
}

test("cross-origin mutations to the API are rejected before reaching any handler", async ({
  request,
}) => {
  const response = await request.post("/api/v1/me", {
    headers: { Origin: "https://evil.example" },
    data: {},
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["content-type"]).toContain(
    "application/problem+json",
  );
  expect(((await response.json()) as { code: string }).code).toBe(
    "origin_not_allowed",
  );
});

// Owner decision D-02: public self-registration must not exist. Stays green only while it is absent.
for (const path of [
  "/register",
  "/signup",
  "/sign-up",
  "/api/auth/sign-up/email",
  "/api/v1/register",
]) {
  test(`self-registration path ${path} does not exist`, async ({
    request,
    baseURL,
  }) => {
    expect((await request.get(path)).status()).toBe(404);

    // The production-mode server requires an HTTPS SITE_URL, while Playwright
    // reaches the local server over HTTP. Use the configured trusted origin so
    // this assertion tests route absence rather than failing at the origin gate.
    const trustedOrigin = new URL(
      process.env.SITE_URL ?? baseURL ?? "",
    ).origin;
    expect(
      (
        await request.post(path, {
          headers: { Origin: trustedOrigin },
          data: {},
        })
      ).status(),
    ).toBe(404);
  });
}
