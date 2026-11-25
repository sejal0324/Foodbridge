/**
 * Query keys of the admin area (kept here so the shared `qk` table is not
 * edited while other areas are being built). Shared resources that admins read
 * through role-neutral endpoints (donations, assistance requests, pickups,
 * analytics) keep using `qk` so invalidation stays consistent.
 */
export const adminKeys = {
  all: ['admin'] as const,
  verifications: (params: object) => ['admin', 'verifications', params] as const,
  verificationsAll: ['admin', 'verifications'] as const,
  orgDocuments: (type: string, id: string) => ['admin', 'org-documents', type, id] as const,
  users: (params: object) => ['admin', 'users', params] as const,
  usersAll: ['admin', 'users'] as const,
  settings: ['admin', 'settings'] as const,
  auditLogs: (params: object) => ['admin', 'audit-logs', params] as const,
  jobs: (params: object) => ['admin', 'jobs', params] as const,
  jobsAll: ['admin', 'jobs'] as const,
  deliveries: (params: object) => ['admin', 'deliveries', params] as const,
  readiness: ['admin', 'readiness'] as const,
  verificationLogs: ['admin', 'verification-logs'] as const,
  activeTracking: ['admin', 'tracking', 'active'] as const,
  disputes: (status: string) => ['admin', 'disputes', status] as const,
  disputesAll: ['admin', 'disputes'] as const,
  rewardRules: ['admin', 'reward-rules'] as const,
  feeRules: ['admin', 'fee-rules'] as const,
  billing: ['admin', 'billing'] as const,
  invoices: ['admin', 'billing', 'invoices'] as const,
  feeLines: (page: number) => ['admin', 'billing', 'fee-lines', page] as const,
  payments: ['admin', 'billing', 'payments'] as const,
  aiPerformance: ['admin', 'ai-performance'] as const,
} as const;
