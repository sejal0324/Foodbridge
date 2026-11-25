import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations, 1 lane).
// `algorithm: 2` is Argon2id (the library exposes it as an ambient const enum).
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

// Verified against when the account does not exist, so response timing does
// not reveal which emails are registered.
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hash('foodbridge-timing-equaliser', OPTIONS);
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
