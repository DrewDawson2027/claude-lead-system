/**
 * Auth tests — intentionally incomplete for demo purposes.
 * Workers will be asked to add missing tests during the demo.
 */

import { login, register } from "../src/auth";

describe("auth", () => {
  test("login returns error for unknown user", async () => {
    const result = await login("unknown@test.com", "password123");
    expect(result.success).toBe(false);
    expect(result.error).toBe("User not found");
  });

  // TODO: test login with valid credentials
  // TODO: test register creates new user
  // TODO: test register rejects duplicate email
  // TODO: test token generation
});
