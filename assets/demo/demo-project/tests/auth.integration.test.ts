import { login, register } from "../src/auth";

describe("auth integration", () => {
  test("login returns error for unknown user", async () => {
    const result = await login("unknown@test.com", "password123");
    expect(result.success).toBe(false);
    expect(result.error).toBe("User not found");
  });

  test("register returns a token for a new user", async () => {
    const result = await register("new@test.com", "password123");
    expect(result.success).toBe(true);
    expect(typeof result.token).toBe("string");
  });
});
