import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(
      true,
    );
  });

  it("rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("incorrect horse battery staple", stored)).toBe(
      false,
    );
  });

  it("salts every hash uniquely", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
  });

  it("returns false for malformed stored hashes instead of throwing", async () => {
    await expect(verifyPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("x", "")).resolves.toBe(false);
    await expect(verifyPassword("x", "bcrypt:abc:def")).resolves.toBe(false);
  });

  it("normalizes unicode so equivalent inputs verify", async () => {
    const stored = await hashPassword("café\u00A0");
    expect(await verifyPassword("café\u00A0", stored)).toBe(true);
  });
});
