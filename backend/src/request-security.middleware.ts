import type { NextFunction, Request, Response } from 'express';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sameOriginMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (safeMethods.has(request.method)) {
    next();
    return;
  }
  if (request.header('Sec-Fetch-Site') === 'cross-site') {
    deny(response);
    return;
  }
  const origin = request.header('Origin');
  if (!origin) {
    next();
    return;
  }
  const forwardedProto = request.header('X-Forwarded-Proto')?.split(',')[0].trim();
  const protocol = forwardedProto || request.protocol;
  const expected = `${protocol}://${request.header('Host')}`;
  if (origin !== expected) {
    deny(response);
    return;
  }
  next();
}

function deny(response: Response) {
  response.status(403).json({
    error: { code: 'CROSS_SITE_REQUEST_DENIED', message: 'Cross-site request denied' },
  });
}

