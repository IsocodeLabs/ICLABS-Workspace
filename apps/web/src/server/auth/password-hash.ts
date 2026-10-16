import { hash, verify } from "@node-rs/argon2";

// Argon2id (the library default) with OWASP-recommended parameters: 19 MiB, 2 iterations, 1 lane.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/** A real hash to verify against when the account doesn't exist, so timing doesn't leak it. */
let dummyHash: Promise<string> | undefined;
export async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password-placeholder");
  await verifyPassword(await dummyHash, password);
}
