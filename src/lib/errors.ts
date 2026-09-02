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

/** Narrowing helper so handlers can map thrown errors onto the Block D shape. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
