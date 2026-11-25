import type { LatLng } from './api';
import type { BusinessType, VerificationStatus } from './common';

export interface FoodCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  reviewFlagHoursAfterPreparation: number | null;
  requiresRefrigeration: boolean;
}

export interface AvailabilitySlot {
  isoDayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

/** GET /api/donors/me */
export interface DonorProfile {
  id: string;
  businessName: string;
  businessType: BusinessType;
  licenseNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  location: LatLng | null;
  timezone: string;
  verificationStatus: VerificationStatus;
  verificationNotes: string | null;
  verifiedAt: string | null;
  acceptsAssistanceRequests: boolean;
  pausedUntil: string | null;
  publicRecognitionConsent: boolean;
  createdAt: string;
  categories: { id: string; code: string }[];
  availability: AvailabilitySlot[];
}

export interface DonorProfileUpdate {
  businessName?: string;
  businessType?: BusinessType;
  licenseNumber?: string;
  contactPhone?: string;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  location?: LatLng;
  acceptsAssistanceRequests?: boolean;
  pausedUntil?: string | null;
  publicRecognitionConsent?: boolean;
}

export const DOCUMENT_TYPES = ['BUSINESS_LICENCE', 'FSSAI_LICENCE', 'NGO_REGISTRATION', 'TAX_EXEMPTION', 'ID_PROOF', 'OTHER'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface VerificationDocument {
  id: string;
  organizationType: 'DONOR' | 'NGO';
  organizationId: string;
  documentType: DocumentType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | string;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
