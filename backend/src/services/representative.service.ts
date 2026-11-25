import type { AppConfig } from '../config/env.js';
import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import type { EmailProvider } from '../integrations/email.js';
import { detectMime, type LocalFileStorage } from '../integrations/storage.js';
import { findUserByEmail, insertUser } from '../repositories/user.repository.js';
import { revokeAllForUser } from '../repositories/session.repository.js';
import type { Actor, AuthContext } from '../types/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { AuthService } from './auth.service.js';

interface RepRow {
  id: string;
  ngo_id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  account_status: string;
  id_document_type: string;
  id_document_last4: string;
  photo_storage_key: string | null;
  status: string;
  created_at: Date;
}

const SELECT = `SELECT r.id, r.ngo_id, r.user_id, u.full_name, u.email, u.phone, u.account_status, r.id_document_type, r.id_document_last4,
                       r.photo_storage_key, r.status, r.created_at
                  FROM ngo_representatives r JOIN users u ON u.id = r.user_id`;

const toDto = (r: RepRow) => ({
  id: r.id,
  userId: r.user_id,
  fullName: r.full_name,
  email: r.email,
  phone: r.phone,
  accountStatus: r.account_status,
  idDocumentType: r.id_document_type,
  idDocumentLast4: r.id_document_last4,
  hasPhoto: Boolean(r.photo_storage_key),
  status: r.status,
  createdAt: r.created_at,
});

/** NGO representatives: people authorised to collect food. Each has their own login (invitation-based). */
export class RepresentativeService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly email: EmailProvider,
    private readonly storage: LocalFileStorage,
  ) {}

  async list(auth: AuthContext) {
    if (!auth.ngoId) throw forbidden();
    const rows = await many<RepRow>(this.db, `${SELECT} WHERE r.ngo_id = $1 AND r.deleted_at IS NULL ORDER BY r.created_at`, [auth.ngoId]);
    return rows.map(toDto);
  }

  /**
   * Adds a representative. `self: true` registers the NGO owner as a
   * representative (small NGOs). Otherwise an INVITED account is created and a
   * single-use invitation link (72 h) is returned to the owner and emailed if
   * email delivery is configured.
   */
  async create(
    auth: AuthContext,
    input: { self: boolean; fullName?: string | undefined; email?: string | undefined; phone: string; idDocumentType: string; idDocumentLast4: string },
    actor: Actor,
  ) {
    if (!auth.ngoId) throw forbidden();
    const result = await this.db.transaction(async (tx) => {
      let userId: string;
      let inviteToken: string | null = null;
      if (input.self) {
        if (auth.representativeId) throw conflict('You are already registered as a representative.', 'ALREADY_REPRESENTATIVE');
        userId = auth.userId;
        await tx.query('UPDATE users SET phone = $2 WHERE id = $1', [userId, input.phone]);
      } else {
        if (!input.email || !input.fullName) throw unprocessable('Name and email are required to invite a representative.', 'INVITE_DETAILS_REQUIRED');
        if (await findUserByEmail(tx, input.email)) throw conflict('An account with this email already exists.', 'EMAIL_TAKEN');
        const user = await insertUser(tx, { email: input.email, passwordHash: null, role: 'NGO', fullName: input.fullName, phone: input.phone, status: 'INVITED' });
        await tx.query('INSERT INTO notification_preferences (user_id) VALUES ($1)', [user.id]);
        userId = user.id;
        inviteToken = await this.auth.createAccountToken(tx, user.id, 'INVITE', 72, auth.userId);
      }
      const rep = await one<{ id: string }>(
        tx,
        `INSERT INTO ngo_representatives (ngo_id, user_id, id_document_type, id_document_last4, added_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [auth.ngoId, userId, input.idDocumentType, input.idDocumentLast4.toUpperCase(), auth.userId],
      );
      if (!rep) throw new Error('representative insert failed');
      await recordAudit(tx, actor, { action: 'representative.added', entityType: 'representative', entityId: rep.id, metadata: { self: input.self } });
      return { id: rep.id, inviteToken };
    });
    const inviteUrl = result.inviteToken ? `${this.config.appBaseUrl}/accept-invite?token=${encodeURIComponent(result.inviteToken)}` : null;
    let invitationEmailed = false;
    if (inviteUrl && input.email && this.email.configured) {
      invitationEmailed = await this.email
        .send({
          to: input.email,
          subject: 'FoodBridge: you have been invited as an NGO representative',
          text: `You have been invited to collect food on behalf of an NGO on FoodBridge.\n\nSet your password within 72 hours: ${inviteUrl}`,
        })
        .then(() => true)
        .catch(() => false);
    }
    const row = (await one<RepRow>(this.db, `${SELECT} WHERE r.id = $1`, [result.id])) as RepRow;
    return { ...toDto(row), inviteUrl, invitationEmailed };
  }

  async setStatus(auth: AuthContext, id: string, status: 'ACTIVE' | 'INACTIVE' | 'REVOKED', actor: Actor) {
    await this.db.transaction(async (tx) => {
      const rep = await one<{ ngo_id: string; user_id: string; status: string }>(tx, 'SELECT ngo_id, user_id, status FROM ngo_representatives WHERE id = $1 FOR UPDATE', [id]);
      if (!rep || rep.ngo_id !== auth.ngoId) throw notFound('Representative');
      if (rep.status === 'REVOKED') throw conflict('A revoked representative cannot be changed.', 'REPRESENTATIVE_REVOKED');
      await tx.query('UPDATE ngo_representatives SET status = $2 WHERE id = $1', [id, status]);
      if (status !== 'ACTIVE') {
        // Outstanding QR passes stop working immediately.
        await tx.query(
          `UPDATE pickup_tokens t SET revoked_at = now() FROM pickup_assignments p
            WHERE p.id = t.pickup_assignment_id AND p.representative_id = $1 AND t.consumed_at IS NULL AND t.revoked_at IS NULL`,
          [id],
        );
        if (rep.user_id !== auth.userId) await revokeAllForUser(tx, rep.user_id, 'ADMIN');
      }
      await recordAudit(tx, actor, { action: 'representative.status_changed', entityType: 'representative', entityId: id, changes: { from: rep.status, to: status } });
    });
  }

  async uploadPhoto(auth: AuthContext, id: string, buffer: Buffer, actor: Actor) {
    const rep = await one<{ ngo_id: string }>(this.db, 'SELECT ngo_id FROM ngo_representatives WHERE id = $1', [id]);
    if (!rep || rep.ngo_id !== auth.ngoId) throw notFound('Representative');
    const mime = detectMime(buffer);
    if (mime !== 'image/jpeg' && mime !== 'image/png') throw unprocessable('Photos must be JPEG or PNG.', 'UNSUPPORTED_FILE_TYPE');
    const key = await this.storage.save('representatives', buffer, mime);
    await this.db.query('UPDATE ngo_representatives SET photo_storage_key = $2 WHERE id = $1', [id, key]);
    await recordAudit(this.db, actor, { action: 'representative.photo_updated', entityType: 'representative', entityId: id });
  }

  /** Photo is visible to the NGO owner, the representative, admins, and the donor of an active pickup by this representative. */
  async readPhoto(auth: AuthContext, id: string): Promise<{ buffer: Buffer; mime: string }> {
    const rep = await one<{ ngo_id: string; user_id: string; photo_storage_key: string | null }>(this.db, 'SELECT ngo_id, user_id, photo_storage_key FROM ngo_representatives WHERE id = $1', [id]);
    if (!rep?.photo_storage_key) throw notFound('Photo');
    let allowed = auth.role === 'ADMIN' || rep.ngo_id === auth.ngoId || rep.user_id === auth.userId;
    if (!allowed && auth.donorId) {
      const active = await one<{ n: number }>(
        this.db,
        `SELECT count(*) AS n FROM pickup_assignments p JOIN donation_allocations a ON a.id = p.allocation_id JOIN donations d ON d.id = a.donation_id
          WHERE p.representative_id = $1 AND d.donor_id = $2 AND p.status IN ('ASSIGNED','EN_ROUTE','VERIFIED','HANDED_OVER')`,
        [id, auth.donorId],
      );
      allowed = (active?.n ?? 0) > 0;
    }
    if (!allowed) throw notFound('Photo');
    return { buffer: await this.storage.read(rep.photo_storage_key), mime: rep.photo_storage_key.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  }
}
