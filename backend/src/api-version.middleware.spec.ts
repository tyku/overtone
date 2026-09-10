import type { NextFunction, Request, Response } from 'express';
import {
  API_VERSION_HEADER,
  SUPPORTED_API_VERSIONS_HEADER,
  apiVersionMiddleware,
} from './api-version.middleware';

describe('apiVersionMiddleware', () => {
  it('advertises the supported version and accepts a matching client', () => {
    const request = { header: jest.fn().mockReturnValue('1') } as unknown as Request;
    const response = { setHeader: jest.fn() } as unknown as Response;
    const next = jest.fn() as NextFunction;

    apiVersionMiddleware(request, response, next);

    expect(response.setHeader).toHaveBeenCalledWith(API_VERSION_HEADER, '1');
    expect(response.setHeader).toHaveBeenCalledWith(SUPPORTED_API_VERSIONS_HEADER, '1');
    expect(next).toHaveBeenCalled();
  });

  it('rejects an unsupported requested version', () => {
    const request = { header: jest.fn().mockReturnValue('2') } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { setHeader: jest.fn(), status } as unknown as Response;
    const next = jest.fn() as NextFunction;

    apiVersionMiddleware(request, response, next);

    expect(status).toHaveBeenCalledWith(412);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'API_VERSION_UNSUPPORTED',
        message: 'API version 2 is not supported',
      },
    });
    expect(next).not.toHaveBeenCalled();
  });
});
