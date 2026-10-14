export class RequestBodyTooLargeError extends Error {}

export function parseBoundedJson(request: Request, maxBytes?: number): Promise<unknown>;
