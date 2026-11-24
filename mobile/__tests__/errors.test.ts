import { ApiError, toApiError } from '../src/lib/errors';

describe('error mapping', () => {
  test('known server codes become friendly text', () => {
    const e = toApiError({ message: 'rate_limited' });
    expect(e.code).toBe('rate_limited');
    expect(e.userMessage).toMatch(/a little fast/);
  });
  test('unknown server detail is never shown to the user', () => {
    const e = toApiError({ message: 'duplicate key value violates unique constraint "x"' });
    expect(e.userMessage).toBe('Something went wrong. Please try again.');
    expect(e.userMessage).not.toMatch(/duplicate|constraint/);
  });
  test('network failures are flagged offline', () => {
    const e = toApiError({ message: 'Network request failed' });
    expect(e.offline).toBe(true);
    expect(e.userMessage).toMatch(/offline/);
  });
  test('expired tokens ask to sign in again', () => {
    expect(toApiError({ message: 'JWT expired', code: 'PGRST301' }).code).toBe('not_authenticated');
  });
  test('ApiError carries its code', () => { expect(new ApiError('not_found').code).toBe('not_found'); });
});
