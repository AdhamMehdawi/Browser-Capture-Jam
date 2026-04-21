export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const BadRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const Unauthorized = (code = 'unauthorized', message = 'Unauthorized') =>
  new HttpError(401, code, message);
export const Forbidden = (code = 'forbidden', message = 'Forbidden') =>
  new HttpError(403, code, message);
export const NotFound = (code = 'not_found', message = 'Not found') =>
  new HttpError(404, code, message);
export const Conflict = (code: string, message: string) => new HttpError(409, code, message);
