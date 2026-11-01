import { describe, expect, it } from "vitest";
import { problemResponse } from "@/lib/http/problem";

describe("problemResponse", () => {
  it("uses problem+json, no-store and the requested status", async () => {
    const response = problemResponse({
      status: 403,
      code: "origin_not_allowed",
      title: "Request origin not allowed",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["code"]).toBe("origin_not_allowed");
    expect(body["status"]).toBe(403);
    expect(typeof body["requestId"]).toBe("string");
  });
  it("generates a distinct request id per response unless one is supplied", async () => {
    const a = (await problemResponse({
      status: 404,
      code: "not_found",
      title: "Not found",
    }).json()) as { requestId: string };
    const b = (await problemResponse({
      status: 404,
      code: "not_found",
      title: "Not found",
    }).json()) as { requestId: string };
    expect(a.requestId === b.requestId).toBe(false);
    const c = (await problemResponse({
      status: 404,
      code: "not_found",
      title: "Not found",
      requestId: "req-1",
    }).json()) as { requestId: string };
    expect(c.requestId).toBe("req-1");
  });
  it("includes field errors only when provided and never invents stack data", async () => {
    const plain = JSON.stringify(
      await problemResponse({
        status: 500,
        code: "internal",
        title: "Internal error",
      }).json(),
    );
    expect(plain).not.toContain("stack");
    expect(plain).not.toContain("errors");
    const withErrors = JSON.stringify(
      await problemResponse({
        status: 422,
        code: "validation_failed",
        title: "Invalid",
        errors: [{ path: "name", message: "Required" }],
      }).json(),
    );
    expect(withErrors).toContain('"path":"name"');
  });
  it("rejects non-error statuses", () => {
    for (const status of [200, 302, 399, 600, 403.5]) {
      expect(() =>
        problemResponse({ status, code: "x", title: "x" }),
      ).toThrow();
    }
  });
});
