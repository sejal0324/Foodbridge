import type { Database } from '../db/database.js';
import { many, one } from '../db/database.js';
import { detectMime, sanitizeFilename, type LocalFileStorage } from '../integrations/storage.js';
import { revokeAllForUser } from '../repositories/session.repository.js';
import type { Actor, AuthContext } from '../types/auth.js';
import { sha256Hex } from '../utils/crypto.js';
import { badRequest, forbidden, notFound, unprocessable } from '../utils/errors.js';
import { recordAudit } from './audit.service.js';
import type { NotificationService } from './notification.service.js';

export type OrgType = 'DONOR' | 'NGO';
export type DocumentType = 'BUSINESS_LICENCE' | 'FSSAI_LICENCE' | 'NGO_REGISTRATION' | 'TAX_EXEMPTION' | 'ID_PROOF' | 'OTHER';

interface DocumentRow {
  id: string;
  donor_id: string | null;
  ngo_id: string | null;
  document_type: string;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  review_notes: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

const toDocumentDto = (d: DocumentRow) => ({
  id: d.id,
  organizationType: d.donor_id ? 'DONOR' : 'NGO',
  organizationId: d.donor_id ?? d.ngo_id,
  documentType: d.document_type,
  originalFilename: d.original_filename,
  mimeType: d.mime_type,
  sizeBytes: d.size_bytes,
  status: d.status,
  reviewNotes: d.review_notes,
  reviewedAt: d.reviewed_at,
  createdAt: d.created_at,
});

const ORG_TABLE: Record<OrgType, { table: 'donors' | 'ngos'; nameColumn: string; entity: 'donor' | 'ngo' }> = {
  DONOR: { table: 'donors', nameColumn: 'business_name', entity: 'donor' },
  NGO: { table: 'ngos', nameColumn: 'organization_name', entity: 'ngo' },
};

export class VerificationService {
  constructor(
    private readonly db: Database,
    private readonly storage: LocalFileStorage,
    private readonly notifications: NotificationService,
  ) {}

  async uploadDocument(auth: AuthContext, documentType: DocumentType, file: { buffer: Buffer; originalname: string }, actor: Actor) {
    const orgColumn = auth.donorId ? 'donor_id' : auth.ngoId ? 'ngo_id' : null;
    const orgId = auth.donorId ?? auth.ngoId;
    if (!orgColumn || !orgId) throw forbidden('Only organisation owners can upload verification documents.');
    const mime = detectMime(file.buffer);
    if (!mime) throw unprocessable('Only PDF, JPEG and PNG files are accepted.', 'UNSUPPORTED_FILE_TYPE');
    const key = await this.storage.save('documents', file.buffer, mime);
    const row = await this.db.transaction(async (tx) => {
      const doc = await one<DocumentRow>(
        tx,
        `INSERT INTO verification_documents (${orgColumn}, document_type, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [orgId, documentType, key, sanitizeFilename(file.originalname), mime, file.buffer.length, sha256Hex(file.buffer), auth.userId],
      );
      if (!doc) throw new Error('document insert failed');
      await recordAudit(tx, actor, {
        action: 'verification.document_uploaded',
        entityType: orgColumn === 'donor_id' ? 'donor' : 'ngo',
        entityId: orgId,
        metadata: { documentId: doc.id, documentType, mime, sizeBytes: file.buffer.length },
      });
      return doc;
    });
    return toDocumentDto(row);
  }

  async listOwnDocuments(auth: AuthContext) {
    const rows = await many<DocumentRow>(
      this.db,
      `SELECT * FROM verification_documents WHERE ($1::uuid IS NOT NULL AND donor_id = $1) OR ($2::uuid IS NOT NULL AND ngo_id = $2)
        ORDER BY created_at DESC`,
      [auth.donorId, auth.ngoId],
    );
    return rows.map(toDocumentDto);
  }

  /** Admin, or the owning organisation, may download a document. */
  async readDocument(auth: AuthContext, id: string): Promise<{ buffer: Buffer; mime: string; filename: string }> {
    const doc = await one<DocumentRow>(this.db, 'SELECT * FROM verification_documents WHERE id = $1', [id]);
    if (!doc) throw notFound('Document');
    const owns = (doc.donor_id && doc.donor_id === auth.donorId) || (doc.ngo_id && doc.ngo_id === auth.ngoId);
    if (auth.role !== 'ADMIN' && !owns) throw notFound('Document');
    return { buffer: await this.storage.read(doc.storage_key), mime: doc.mime_type, filename: doc.original_filename };
  }

  async listApplications(filter: { status?: string | undefined; type?: OrgType | undefined }) {
    const status = filter.status ?? 'PENDING';
    const parts: string[] = [];
    for (const type of filter.type ? [filter.type] : (['DONOR', 'NGO'] as OrgType[])) {
      const { table, nameColumn } = ORG_TABLE[type];
      const docColumn = type === 'DONOR' ? 'donor_id' : 'ngo_id';
      parts.push(`
        SELECT '${type}' AS type, o.id, o.${nameColumn} AS name, o.verification_status, o.verification_notes, o.created_at,
               o.city, u.full_name AS owner_name, u.email AS owner_email,
               (SELECT count(*) FROM verification_documents v WHERE v.${docColumn} = o.id) AS document_count
          FROM ${table} o JOIN users u ON u.id = o.owner_user_id
         WHERE o.deleted_at IS NULL AND o.verification_status = $1`);
    }
    const rows = await many<{
      type: OrgType;
      id: string;
      name: string;
      verification_status: string;
      verification_notes: string | null;
      created_at: Date;
      city: string | null;
      owner_name: string;
      owner_email: string;
      document_count: number;
    }>(this.db, `${parts.join(' UNION ALL ')} ORDER BY created_at`, [status]);
    return rows.map((r) => ({
      type: r.type,
      id: r.id,
      name: r.name,
      verificationStatus: r.verification_status,
      verificationNotes: r.verification_notes,
      city: r.city,
      ownerName: r.owner_name,
      ownerEmail: r.owner_email,
      documentCount: r.document_count,
      createdAt: r.created_at,
    }));
  }

  async listOrganisationDocuments(type: OrgType, orgId: string) {
    const column = type === 'DONOR' ? 'donor_id' : 'ngo_id';
    const rows = await many<DocumentRow>(this.db, `SELECT * FROM verification_documents WHERE ${column} = $1 ORDER BY created_at DESC`, [orgId]);
    return rows.map(toDocumentDto);
  }

  async reviewDocument(id: string, status: 'ACCEPTED' | 'REJECTED', notes: string | undefined, actor: Actor) {
    await this.db.transaction(async (tx) => {
      const res = await tx.query(
        `UPDATE verification_documents SET status = $2, review_notes = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`,
        [id, status, notes ?? null, actor.userId],
      );
      if (res.rowCount === 0) throw notFound('Document');
      await recordAudit(tx, actor, { action: 'verification.document_reviewed', entityType: 'verification_document', entityId: id, changes: { status, notes } });
    });
  }

  /** Approve, reject or suspend an organisation. The owner is notified; suspension also ends their sessions. */
  async decide(type: OrgType, orgId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED', notes: string | undefined, actor: Actor) {
    const { table, nameColumn, entity } = ORG_TABLE[type];
    const notice = await this.db.transaction(async (tx) => {
      const org = await one<{ verification_status: string; owner_user_id: string; name: string }>(
        tx,
        `SELECT verification_status, owner_user_id, ${nameColumn} AS name FROM ${table} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [orgId],
      );
      if (!org) throw notFound(type === 'DONOR' ? 'Donor' : 'NGO');
      if (status === 'REJECTED' && !notes) throw badRequest('A reason is required when rejecting an application.', undefined, 'REASON_REQUIRED');
      if (org.verification_status === status) throw unprocessable(`The organisation is already ${status}.`, 'NO_CHANGE');
      await tx.query(
        `UPDATE ${table} SET verification_status = $2, verification_notes = $3, verified_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE verified_at END,
                verified_by = $4 WHERE id = $1`,
        [orgId, status, notes ?? null, actor.userId],
      );
      if (status === 'SUSPENDED') await revokeAllForUser(tx, org.owner_user_id, 'ADMIN');
      await recordAudit(tx, actor, {
        action: `verification.${status.toLowerCase()}`,
        entityType: entity,
        entityId: orgId,
        changes: { from: org.verification_status, to: status, notes },
      });
      const messages = {
        APPROVED: { title: 'Your organisation is verified', body: `${org.name} has been verified. You now have full access to FoodBridge.` },
        REJECTED: { title: 'Verification needs attention', body: `${org.name} could not be verified: ${notes ?? ''}. Update your profile or documents to resubmit.` },
        SUSPENDED: { title: 'Organisation suspended', body: `${org.name} has been suspended. ${notes ?? ''}` },
      } as const;
      return this.notifications.create(tx, {
        userId: org.owner_user_id,
        type: `VERIFICATION_${status}`,
        ...messages[status],
        linkPath: type === 'DONOR' ? '/donor/profile' : '/ngo/profile',
        priority: 'HIGH',
        dedupeKey: `verification-${status.toLowerCase()}:${orgId}:${Date.now()}`,
        email: true,
      });
    });
    this.notifications.publish([notice]);
  }

  async listUsers(filter: { role?: string | undefined; status?: string | undefined; search?: string | undefined; page: number; pageSize: number }) {
    const where: string[] = ['u.deleted_at IS NULL'];
    const values: unknown[] = [];
    if (filter.role) where.push(`u.role = $${values.push(filter.role)}`);
    if (filter.status) where.push(`u.account_status = $${values.push(filter.status)}`);
    if (filter.search) where.push(`(u.email ILIKE $${values.push(`%${filter.search}%`)} OR u.full_name ILIKE $${values.length})`);
    const whereSql = where.join(' AND ');
    const rows = await many<{
      id: string;
      email: string;
      full_name: string;
      role: string;
      account_status: string;
      last_login_at: Date | null;
      created_at: Date;
      organization_name: string | null;
    }>(
      this.db,
      `SELECT u.id, u.email, u.full_name, u.role, u.account_status, u.last_login_at, u.created_at,
              COALESCE(d.business_name, n.organization_name, rn.organization_name) AS organization_name
         FROM users u
         LEFT JOIN donors d ON d.owner_user_id = u.id
         LEFT JOIN ngos n ON n.owner_user_id = u.id
         LEFT JOIN ngo_representatives r ON r.user_id = u.id
         LEFT JOIN ngos rn ON rn.id = r.ngo_id
        WHERE ${whereSql}
        ORDER BY u.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, filter.pageSize, (filter.page - 1) * filter.pageSize],
    );
    const total = await one<{ n: number }>(this.db, `SELECT count(*) AS n FROM users u WHERE ${whereSql}`, values);
    return {
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        role: r.role,
        accountStatus: r.account_status,
        organizationName: r.organization_name,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
      })),
      total: total?.n ?? 0,
    };
  }

  async setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string | undefined, actor: Actor) {
    if (userId === actor.userId) throw unprocessable('You cannot change your own account status.', 'SELF_STATUS_CHANGE');
    await this.db.transaction(async (tx) => {
      const user = await one<{ account_status: string }>(tx, 'SELECT account_status FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId]);
      if (!user) throw notFound('User');
      if (user.account_status === 'INVITED') throw unprocessable('Invited accounts cannot be changed until they are activated.', 'ACCOUNT_INVITED');
      await tx.query('UPDATE users SET account_status = $2 WHERE id = $1', [userId, status]);
      const revoked = status === 'SUSPENDED' ? await revokeAllForUser(tx, userId, 'ACCOUNT_SUSPENDED') : 0;
      await recordAudit(tx, actor, {
        action: status === 'SUSPENDED' ? 'admin.user_suspended' : 'admin.user_reactivated',
        entityType: 'user',
        entityId: userId,
        changes: { from: user.account_status, to: status, reason },
        metadata: { sessionsRevoked: revoked },
      });
    });
  }
}
