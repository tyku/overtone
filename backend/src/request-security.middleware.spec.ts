import type { NextFunction, Request, Response } from 'express';
import { sameOriginMiddleware } from './request-security.middleware';

function execute(headers: Record<string, string>, method = 'POST') {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;
  const request = {
    method,
    protocol: 'http',
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const next = jest.fn() as NextFunction;
  sameOriginMiddleware(request, response, next);
  return { response, next };
}

describe('sameOriginMiddleware', () => {
  it('accepts same-origin browser mutations', () => {
    const { next } = execute({ host: 'app.example', origin: 'https://app.example', 'x-forwarded-proto': 'https' });
    expect(next).toHaveBeenCalled();
  });

  it('rejects cross-site browser mutations', () => {
    const { response, next } = execute({ host: 'app.example', origin: 'https://evil.example' });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('allows non-browser clients without Origin and safe reads', () => {
    expect(execute({ host: 'app.example' }).next).toHaveBeenCalled();
    expect(execute({ host: 'app.example', origin: 'https://evil.example' }, 'GET').next).toHaveBeenCalled();
  });
});

