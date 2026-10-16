import { randomInt } from "node:crypto";

/** Letters and digits with look-alikes removed (0/O/o, 1/l/I). */
export const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

export const TEMP_PASSWORD_TTL_MS = 72 * 60 * 60 * 1000;

const GROUPS = 3;
const GROUP_LENGTH = 4;

/** A 12-character random password, formatted as `xxxx-xxxx-xxxx` for easy reading. */
export function generateTempPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

export function tempPasswordExpiry(now: Date): Date {
  return new Date(now.getTime() + TEMP_PASSWORD_TTL_MS);
}

export function isTempPasswordExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && now.getTime() >= expiresAt.getTime();
}
