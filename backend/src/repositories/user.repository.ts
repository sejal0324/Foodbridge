import type { Queryable } from '../db/database.js';
import { one } from '../db/database.js';
import type { AuthContext, Role, VerificationStatus } from '../types/auth.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  role: Role;
  account_status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  full_name: string;
  phone: string | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

const USER_COLUMNS = `id, email, password_hash, role, account_status, full_name, phone,
  failed_login_attempts, locked_until, last_login_at, created_at`;

export function findUserByEmail(q: Queryable, email: string): Promise<UserRow | undefined> {
  return one<UserRow>(q, `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 AND deleted_at IS NULL`, [email]);
}

export function findUserById(q: Queryable, id: string): Promise<UserRow | undefined> {
  return one<UserRow>(q, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
}

export async function insertUser(
  q: Queryable,
  u: { email: string; passwordHash: string | null; role: Role; fullName: string; phone?: string | null; status?: UserRow['account_status'] },
): Promise<UserRow> {
  const row = await one<UserRow>(
    q,
    `INSERT INTO users (email, password_hash, role, full_name, phone, account_status, password_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $2::text IS NULL THEN NULL ELSE now() END)
     RETURNING ${USER_COLUMNS}`,
    [u.email, u.passwordHash, u.role, u.fullName, u.phone ?? null, u.status ?? 'ACTIVE'],
  );
  if (!row) throw new Error('user insert returned no row');
  return row;
}

interface AuthRow {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  account_status: UserRow['account_status'];
  revoked_at: Date | null;
  expires_at: Date;
  donor_id: string | null;
  donor_status: VerificationStatus | null;
  ngo_id: string | null;
  ngo_status: VerificationStatus | null;
  rep_id: string | null;
  rep_ngo_id: string | null;
  rep_status: string | null;
  admin_level: AuthContext['adminLevel'];
}

/** Loads session + user + organisation membership in one query. */
export async function loadAuthRow(q: Queryable, sessionId: string, userId: string): Promise<AuthRow | undefined> {
  return one<AuthRow>(
    q,
    `SELECT u.id, u.email, u.full_name, u.role, u.account_status,
            s.revoked_at, s.expires_at,
            d.id AS donor_id, d.verification_status AS donor_status,
            n.id AS ngo_id, n.verification_status AS ngo_status,
            r.id AS rep_id, r.ngo_id AS rep_ngo_id, r.status AS rep_status,
            a.admin_level
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
       LEFT JOIN donors d ON d.owner_user_id = u.id AND d.deleted_at IS NULL
       LEFT JOIN ngos n ON n.owner_user_id = u.id AND n.deleted_at IS NULL
       LEFT JOIN ngo_representatives r ON r.user_id = u.id AND r.deleted_at IS NULL
       LEFT JOIN admin_profiles a ON a.user_id = u.id
      WHERE s.id = $1 AND u.id = $2`,
    [sessionId, userId],
  );
}

export function toAuthContext(row: AuthRow, sessionId: string): AuthContext {
  return {
    userId: row.id,
    sessionId,
    role: row.role,
    email: row.email,
    fullName: row.full_name,
    donorId: row.donor_id,
    donorStatus: row.donor_status,
    ngoId: row.ngo_id,
    ngoStatus: row.ngo_status,
    representativeId: row.rep_id,
    representativeNgoId: row.rep_ngo_id,
    representativeActive: row.rep_status === 'ACTIVE',
    adminLevel: row.admin_level,
  };
}

export function listAdminUserIds(q: Queryable): Promise<{ id: string }[]> {
  return q
    .query<{ id: string }>(`SELECT id FROM users WHERE role = 'ADMIN' AND account_status = 'ACTIVE' AND deleted_at IS NULL`)
    .then((r) => r.rows);
}
