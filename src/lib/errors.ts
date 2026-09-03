import { ERROR_CODES } from '@/lib/copy';

/**
 * The canonical API error shape and the errors that map onto it (SPEC Block D).
 *
 * Deliberately NOT `server-only`: one class, imported by both gates
 * (`lib/chat.ts`, `lib/retrieval.ts`), the API gate twin
 * (`lib/auth/requireApiUser.ts`) and every route handler. Two divergent
 * `UnauthorizedError` classes would let a handler's `instanceof` check miss one
 * and answer 500 where Block D mandates 401.
 */

export type ApiErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string } };

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }

  get body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

/**
 * 401 UNAUTHORIZED — no verified user. Thrown by both gates and by
 * requireApiUser(). Never leaks whether a row exists: that is NOT_FOUND's job.
 */
export class UnauthorizedError extends ApiError {
  constructor(message = 'You must be signed in.') {
    super(ERROR_CODES.UNAUTHORIZED, 401, message);
  }
}

/** 400 VALIDATION_ERROR — Zod parse failed. Message is the copy the field renders. */
export class ValidationError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.VALIDATION_ERROR, 400, message);
  }
}

/**
 * 404 NOT_FOUND — the row is absent OR owned by another user, and the answer is
 * identical either way. RLS yields no row for a forged id (edge cases S3/S6), and
 * a 403 would confirm that someone else's row exists. Never reveal which.
 */
export class NotFoundError extends ApiError {
  constructor(message = 'Not found.') {
    super(ERROR_CODES.NOT_FOUND, 404, message);
  }
}

/** 413 FILE_TOO_LARGE — upload over 5 MB, refused before any parsing (edge case L5). */
export class FileTooLargeError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.FILE_TOO_LARGE, 413, message);
  }
}

/**
 * 422 UNREADABLE_PDF — no text layer extracted (edge cases D1/D2). Raised before
 * any model call: a scanned PDF must cost nothing and save nothing.
 */
export class UnreadablePdfError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.UNREADABLE_PDF, 422, message);
  }
}

/** 429 DAILY_LIMIT — rule B7, 50 chat calls per rolling 24 h. Embeddings excluded. */
export class DailyLimitError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.DAILY_LIMIT, 429, message);
  }
}

/**
 * 502 AI_UNAVAILABLE — primary AND fallback both failed, after the one owner-approved
 * network retry (edge cases N2/N3/N5).
 *
 * This is also the error a failed RETRIEVAL raises. A `could_not_search` outcome must
 * never be reported as `found_nothing`: telling the user a requirement is a "gap"
 * because an embeddings call died is the app lying about data it never checked
 * (CLAUDE.md, Retrieval — three outcomes, never two).
 */
export class AiUnavailableError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.AI_UNAVAILABLE, 502, message);
  }
}

/**
 * 500 SERVER_ERROR — unexpected failure after validation and auth. The message is
 * GENERIC and never the underlying error text (Block D): a thrown error can carry
 * resume or vacancy content, which must never be rendered or logged.
 */
export class ServerError extends ApiError {
  constructor(message = 'Something went wrong.') {
    super(ERROR_CODES.SERVER_ERROR, 500, message);
  }
}

/** Narrowing helper so handlers can map thrown errors onto the Block D shape. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

/**
 * Map ANY thrown value onto the Block D error response.
 *
 * Uses the web-standard `Response.json` rather than `NextResponse`, so this module
 * stays free of a `next/server` import and remains safe for both gates and handlers
 * to share.
 *
 * An unrecognised throw becomes a generic 500. That default is the point: an error
 * object can carry resume or vacancy text in its message, and echoing it would put
 * personal data into an HTTP body and the client console. Only errors this app raised
 * on purpose get to speak.
 */
export function apiErrorResponse(err: unknown): Response {
  const apiError = isApiError(err) ? err : new ServerError();
  if (!isApiError(err)) {
    // Metadata only — never the message, which may contain personal data.
    console.error('[api] unhandled error mapped to 500 SERVER_ERROR', {
      name: err instanceof Error ? err.name : typeof err,
    });
  }
  return Response.json(apiError.body, { status: apiError.status });
}
