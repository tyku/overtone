import { parseCookies } from './session.guard';

describe('parseCookies', () => {
  it('parses encoded cookie values without accepting malformed input', () => {
    expect(parseCookies('theme=dark; overtone_session=a%2Fb')).toEqual({
      theme: 'dark',
      overtone_session: 'a/b',
    });
    expect(parseCookies('broken=%E0%A4%A')).toEqual({});
  });
});

