import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_VERSION_HEADER, RequestApi } from '../src/request-api';

afterEach(() => vi.unstubAllGlobals());

describe('RequestApi version contract', () => {
  it('sends and validates the API version header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          [API_VERSION_HEADER]: '1',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new RequestApi().list();

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get(API_VERSION_HEADER)).toBe('1');
  });

  it('rejects a response from an incompatible API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            [API_VERSION_HEADER]: '2',
          },
        }),
      ),
    );

    await expect(new RequestApi().list()).rejects.toMatchObject({
      code: 'API_VERSION_UNSUPPORTED',
    });
  });
});
