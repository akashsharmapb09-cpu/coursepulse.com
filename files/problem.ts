/** RFC 9457-style error responses (docs/api-specification.md §1). Never include stack traces, SQL or library messages. */

export interface ProblemOptions {
  status: number;
  /** Stable machine-readable code, e.g. "origin_not_allowed". */
  code: string;
  title: string;
  requestId?: string;
  errors?: ReadonlyArray<{ path: string; message: string }>;
}

export function problemResponse(options: ProblemOptions): Response {
  if (!Number.isInteger(options.status) || options.status < 400 || options.status > 599) {
    throw new RangeError("problem status must be an HTTP error status (400-599)");
  }
  const body = {
    type: "about:blank",
    title: options.title,
    status: options.status,
    code: options.code,
    requestId: options.requestId ?? crypto.randomUUID(),
    ...(options.errors ? { errors: options.errors } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: options.status,
    headers: { "Content-Type": "application/problem+json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
