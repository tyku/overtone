import type { NextFunction, Request, Response } from 'express';

export const API_VERSION_HEADER = 'X-Overtone-API-Version';
export const API_VERSION = '1';
export const SUPPORTED_API_VERSIONS_HEADER = 'X-Overtone-Supported-API-Versions';
export const SUPPORTED_API_VERSIONS = [API_VERSION] as const;

export function apiVersionMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestedVersion = request.header(API_VERSION_HEADER);
  response.setHeader(SUPPORTED_API_VERSIONS_HEADER, SUPPORTED_API_VERSIONS.join(', '));
  if (
    requestedVersion &&
    !SUPPORTED_API_VERSIONS.includes(requestedVersion as (typeof SUPPORTED_API_VERSIONS)[number])
  ) {
    response.setHeader(API_VERSION_HEADER, API_VERSION);
    response.status(412).json({
      error: {
        code: 'API_VERSION_UNSUPPORTED',
        message: `API version ${requestedVersion} is not supported`,
      },
    });
    return;
  }
  response.setHeader(API_VERSION_HEADER, requestedVersion ?? API_VERSION);
  next();
}
