/**
 * Server-side administrator provisioning (there is no public admin registration).
 *
 *   npm run admin:create -- --email admin@example.org --name "Asha Admin"
 *
 * The password is read from ADMIN_PASSWORD or prompted for interactively.
 */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { ConfigError, loadEnvFiles, parseConfig } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { Database } from '../db/database.js';
import { provisionAdmin } from '../services/admin-provisioning.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const config = parseConfig();
  const email = arg('email');
  const name = arg('name');
  if (!email || !name) throw new Error('Usage: npm run admin:create -- --email <email> --name "<full name>"');
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: stdin, output: stdout });
    password = await rl.question('Password (min 10 chars, letters and digits; input is visible): ');
    rl.close();
  }
  const db = new Database(config.database.url, 2, createLogger('error'));
  try {
    const admin = await provisionAdmin(db, { email, fullName: name, password });
    console.log(`Created ${admin.level} ${email} (${admin.id}).`);
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err instanceof Error ? err.message : err);
  process.exit(1);
});
