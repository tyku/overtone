import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_VERSION_HEADER, RequestApi } from '../src/request-api';

afterEach(() => vi.unstubAllGlobals());

describe('RequestApi version contract', () => {
  it('does not create a demo request when the backend lacks demo support', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'INVALID_REQUEST_ID', message: 'Invalid request ID' },
        }),
        {
          status: 400,
          headers: { [API_VERSION_HEADER]: '1' },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new RequestApi().create('demo')).rejects.toMatchObject({
      code: 'DEMO_UNSUPPORTED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/requests/demo-capability');
  });

  it('creates demo only when the backend confirms the mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ kind: 'demo', ready: true }), {
          status: 200,
          headers: { [API_VERSION_HEADER]: '1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            requestId: 'demo-id',
            kind: 'demo',
            status: 'created',
          }),
          {
            status: 201,
            headers: { [API_VERSION_HEADER]: '1' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    expect((await new RequestApi().create('demo')).kind).toBe('demo');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      kind: 'demo',
    });
  });
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
