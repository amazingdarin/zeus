import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";

import {
  resolveAuthUserFromToken,
  resetAuthUserResolutionCacheForTests,
} from "../src/middleware/auth.ts";

test("auth token resolution: resolves user from local JWT when secret matches", async () => {
  resetAuthUserResolutionCacheForTests();
  const token = jwt.sign(
    {
      user_id: "user-local-1",
      email: "local@example.com",
      username: "local-user",
      token_type: "access",
      iss: "zeus-test",
    },
    "unit-test-secret",
    { expiresIn: "1h" },
  );

  const user = await resolveAuthUserFromToken(
    token,
    {
      jwtSecret: "unit-test-secret",
      authServerUrl: "http://127.0.0.1:8080",
    },
    {
      fetchFn: async () => {
        throw new Error("fetch should not be called when jwt secret is valid");
      },
    },
  );

  assert.deepEqual(user, {
    id: "user-local-1",
    email: "local@example.com",
    username: "local-user",
  });
});

test("auth token resolution: falls back to auth server and caches result", async () => {
  resetAuthUserResolutionCacheForTests();
  let fetchCount = 0;

  const fetchFn = async () => {
    fetchCount += 1;
    return {
      ok: true,
      json: async () => ({
        data: {
          id: "user-remote-1",
          email: "remote@example.com",
          username: "remote-user",
        },
      }),
    } as unknown as Response;
  };

  const first = await resolveAuthUserFromToken(
    "token-remote-1",
    {
      authServerUrl: "http://127.0.0.1:8080",
    },
    { fetchFn },
  );

  const second = await resolveAuthUserFromToken(
    "token-remote-1",
    {
      authServerUrl: "http://127.0.0.1:8080",
    },
    { fetchFn },
  );

  assert.deepEqual(first, {
    id: "user-remote-1",
    email: "remote@example.com",
    username: "remote-user",
  });
  assert.deepEqual(second, first);
  assert.equal(fetchCount, 1);
});

test("auth token resolution: returns null when auth server cannot resolve user", async () => {
  resetAuthUserResolutionCacheForTests();

  const user = await resolveAuthUserFromToken(
    "token-invalid",
    {
      authServerUrl: "http://127.0.0.1:8080",
    },
    {
      fetchFn: async () =>
        ({
          ok: false,
          json: async () => ({}),
        }) as unknown as Response,
    },
  );

  assert.equal(user, null);
});

