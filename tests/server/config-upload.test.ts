import { expect, it } from 'vitest';
import { statusFor } from '../../src/server/api';
import { UPLOAD_MAX_BYTES } from '../../src/server/config';

it('the upload limit is 10 MB', () => {
  expect(UPLOAD_MAX_BYTES).toBe(10485760);
});

it('each upload error code has its status', () => {
  expect(statusFor('too_large')).toBe(413);
  expect(statusFor('upload_unavailable')).toBe(409);
  expect(statusFor('upload_failed')).toBe(500);
  expect(statusFor('bad_upload')).toBe(400);
});
