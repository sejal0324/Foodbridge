import type { Database } from '../db/database.js';
import { one } from '../db/database.js';
import { findUserByEmail, insertUser } from '../repositories/user.repository.js';
import { conflict } from '../utils/errors.js';
import { email as emailSchema, password as passwordSchema } from '../validators/common.js';
import { recordAudit } from './audit.service.js';
import { hashPassword } from './password.service.js';

/**
 * Creates an administrator. Reachable only from server-side code (the
 * `admin:create` CLI and the development seed), never from an HTTP route.
 * The first administrator becomes SUPER_ADMIN.
 */
export async function provisionAdmin(db: Database, input: { email: string; fullName: string; password: string }): Promise<{ id: string; level: string }> {
  const emailAddress = emailSchema.parse(input.email);
  passwordSchema.parse(input.password);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    if (await findUserByEmail(tx, emailAddress)) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
    const existing = await one<{ n: number }>(tx, 'SELECT count(*) AS n FROM admin_profiles');
    const level = (existing?.n ?? 0) === 0 ? 'SUPER_ADMIN' : 'ADMIN';
    const user = await insertUser(tx, { email: emailAddress, passwordHash, role: 'ADMIN', fullName: input.fullName });
    await tx.query('INSERT INTO admin_profiles (user_id, admin_level) VALUES ($1, $2)', [user.id, level]);
    await tx.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [user.id]);
    await recordAudit(tx, { type: 'SERVICE', userId: null, role: null }, {
      action: 'admin.provisioned',
      entityType: 'user',
      entityId: user.id,
      metadata: { level, via: 'server-side provisioning' },
    });
    return { id: user.id, level };
  });
}
