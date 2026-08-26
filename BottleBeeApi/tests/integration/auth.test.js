'use strict';

const db = require('../helpers/testDb');

/**
 * Authentication and session security.
 *
 * The properties tested here are the ones whose failure is not visible from the
 * outside: an account-enumeration leak looks like a working login, and a
 * refresh-token replay that succeeds looks like a working session.
 */
describe('auth', () => {
  let available = false;

  beforeAll(async () => {
    available = await db.isAvailable();
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn('  bottle_bee_test not reachable — skipping. Run: npm run test:db:setup');
    }
  });

  afterAll(async () => {
    if (available) await db.close();
  });

  const maybe = (name, fn) => it(name, async () => {
    if (!available) return;
    await fn();
  });

  describe('login', () => {
    maybe('issues tokens, roles and permissions for valid credentials', async () => {
      const res = await db.post('/auth/login', null, db.CREDENTIALS.admin);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));
      expect(res.body.data.tokens.refreshToken).toEqual(expect.any(String));
      expect(res.body.data.user.roles).toContain('SUPER_ADMIN');
      expect(res.body.data.user.permissions.length).toBeGreaterThan(0);
    });

    maybe('never returns the password hash', async () => {
      const res = await db.post('/auth/login', null, db.CREDENTIALS.customer);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
    });

    maybe('gives the same answer for a wrong password and an unknown email', async () => {
      // Differing responses would let an attacker enumerate registered addresses.
      const wrongPassword = await db.post('/auth/login', null, {
        email: db.CREDENTIALS.customer.email,
        password: 'DefinitelyWrong@123',
      });

      const unknownEmail = await db.post('/auth/login', null, {
        email: 'nobody-at-all@bottlebee.test',
        password: 'DefinitelyWrong@123',
      });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    maybe('rejects a malformed email before touching the database', async () => {
      const res = await db.post('/auth/login', null, {
        email: 'not-an-email',
        password: 'whatever',
      });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    maybe('accepts an RFC 2606 reserved domain', async () => {
      // .test is reserved for exactly this purpose; a TLD-registry check that
      // rejected it would also reject customers on newer real TLDs.
      const res = await db.post('/auth/login', null, db.CREDENTIALS.customer);
      expect(res.status).toBe(200);
    });
  });

  describe('protected routes', () => {
    maybe('refuses a request with no token', async () => {
      const res = await db.post('/users/list', null, {});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });

    maybe('refuses a forged token', async () => {
      const res = await db.post('/users/list', 'not.a.real.token', {});
      expect(res.status).toBe(401);
    });

    maybe('accepts a valid token', async () => {
      const token = await db.login('admin');
      const res = await db.post('/users/list', token, { limit: 1 });
      expect(res.status).toBe(200);
    });
  });

  describe('permissions', () => {
    maybe('refuses an endpoint the caller lacks permission for', async () => {
      // A customer holds no USER_VIEW, so the user list must be closed to them.
      const token = await db.login('customer');
      const res = await db.post('/users/list', token, {});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    maybe('allows an endpoint the caller does hold', async () => {
      const token = await db.login('customer');
      const res = await db.post('/cart/detail', token, {});
      expect(res.status).toBe(200);
    });
  });

  describe('refresh token rotation', () => {
    maybe('issues a new pair and invalidates the presented one', async () => {
      const login = await db.post('/auth/login', null, db.CREDENTIALS.customer);
      const original = login.body.data.tokens.refreshToken;

      const refreshed = await db.post('/auth/refresh-token', null, { refreshToken: original });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body.data.tokens.refreshToken).not.toBe(original);

      // Presenting the rotated token again is a replay, so every session for
      // that user is dropped rather than just this one.
      const replay = await db.post('/auth/refresh-token', null, { refreshToken: original });
      expect(replay.status).toBe(401);
      expect(replay.body.message).toMatch(/no longer valid/i);
    });

    maybe('rejects a garbage refresh token', async () => {
      const res = await db.post('/auth/refresh-token', null, { refreshToken: 'rubbish' });
      expect(res.status).toBe(401);
    });
  });

  describe('me', () => {
    maybe('returns identity, roles and role-specific context', async () => {
      const token = await db.login('customer');
      const res = await db.post('/auth/me', token, {});

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(db.CREDENTIALS.customer.email);
      expect(res.body.data.user.roles).toContain('CUSTOMER');
      expect(res.body.data.context.customerProfile.ageVerified).toBe(true);
    });
  });

  describe('forgot password', () => {
    maybe('reports the same result for a known and an unknown address', async () => {
      const known = await db.post('/auth/forgot-password', null, {
        email: db.CREDENTIALS.customer.email,
      });
      const unknown = await db.post('/auth/forgot-password', null, {
        email: 'nobody-at-all@bottlebee.test',
      });

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body.message).toBe(unknown.body.message);
    });

    maybe('returns the one-time token outside production so the flow is testable', async () => {
      const res = await db.post('/auth/forgot-password', null, {
        email: db.CREDENTIALS.customer.email,
      });
      expect(res.body.data.resetToken).toEqual(expect.any(String));
    });
  });
});
