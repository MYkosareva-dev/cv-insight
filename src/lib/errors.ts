import { ERROR_CODES } from '@/lib/copy';
import type { PlanFeature, PlanId } from '@/lib/plan';

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

/**
 * `plan` and `feature` ride INSIDE `error` (SPEC v3.0, Block D 403/429), so a
 * client that reads `error.code` and `error.message` — every client today — is
 * untouched by their presence.
 */
export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; plan?: PlanId; feature?: PlanFeature };
};

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
 * The shared base of the two PLAN refusals — 403 PLAN_REQUIRED and 429
 * DAILY_LIMIT — raised only by the two gates (rule B11).
 *
 * A base class so that code which catches a failed search can let EVERY refusal
 * through with one check. A refusal is not a failed search: the request was
 * never made, so reporting it as `could_not_search` would describe the app's
 * own budget decision as an outage (CLAUDE.md, Retrieval — three outcomes).
 */
export abstract class PlanRefusalError extends ApiError {
  readonly plan: PlanId;
  readonly feature: PlanFeature;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    refusal: { plan: PlanId; feature: PlanFeature },
  ) {
    super(code, status, message);
    this.plan = refusal.plan;
    this.feature = refusal.feature;
  }

  override get body(): ApiErrorBody {
    return {
      error: { code: this.code, message: this.message, plan: this.plan, feature: this.feature },
    };
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

/**
 * 409 ALREADY_RUNNING — a generate for this application is already in flight
 * (SPEC Block D #5).
 *
 * A duplicate here is not a duplicate row, it is a duplicate SPEND: a second
 * pipeline for the same application costs up to eight more chat requests and
 * inserts a second pair of `resume_versions` rows the user never asked for. It
 * is 409 and not 429, because nothing about the user's daily budget is wrong —
 * the request is simply arriving while its predecessor is still running.
 */
export class AlreadyRunningError extends ApiError {
  constructor(message: string) {
    super(ERROR_CODES.ALREADY_RUNNING, 409, message);
  }
}

/** 413 FILE_TOO_LARGE — upload over 4 MB, refused before any parsing (edge case L5). */
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

/**
 * 403 PLAN_REQUIRED — the caller's plan does not include the feature (SPEC v3.0).
 * The one 403 in the app, and it discloses nothing about any row: it is about the
 * caller's own plan. Distinct from 429 — the plan does not have it, as opposed to
 * the allowance being spent.
 */
export class PlanRequiredError extends PlanRefusalError {
  constructor(message: string, refusal: { plan: PlanId; feature: PlanFeature }) {
    super(ERROR_CODES.PLAN_REQUIRED, 403, message, refusal);
  }
}

/**
 * 429 DAILY_LIMIT — the plan's rolling-24-hour allowance is spent: rule B7's
 * overall chat ceiling, Free's per-step allowances, or rule B7a's re-score
 * ceiling. Embeddings other than `rescore` are excluded by definition.
 */
export class DailyLimitError extends PlanRefusalError {
  constructor(message: string, refusal: { plan: PlanId; feature: PlanFeature }) {
    super(ERROR_CODES.DAILY_LIMIT, 429, message, refusal);
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
