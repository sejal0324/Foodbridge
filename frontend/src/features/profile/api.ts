import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, apiGet, apiPatch, apiPut } from '@/services/apiClient';
import { downloadFile } from '@/services/download';
import { qk } from '@/services/queryKeys';
import type { ApiEnvelope, AvailabilitySlot, DocumentType, DonorProfile, DonorProfileUpdate, VerificationDocument } from '@/types';

export function useDonorProfile() {
  return useQuery({ queryKey: qk.profile.donor, queryFn: () => apiGet<DonorProfile>('/donors/me') });
}

export function useUpdateDonorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DonorProfileUpdate) => apiPatch<DonorProfile>('/donors/me', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profile.donor });
      void qc.invalidateQueries({ queryKey: qk.rewards.all });
    },
  });
}

export function useSetAvailability() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (slots: AvailabilitySlot[]) => apiPut<unknown>('/donors/me/availability', { slots }), onSuccess: () => qc.invalidateQueries({ queryKey: qk.profile.donor }) });
}

export function useSetDonorCategories() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (categoryIds: string[]) => apiPut<unknown>('/donors/me/categories', { categoryIds }), onSuccess: () => qc.invalidateQueries({ queryKey: qk.profile.donor }) });
}

export function useVerificationDocuments() {
  return useQuery({ queryKey: qk.profile.documents, queryFn: () => apiGet<VerificationDocument[]>('/verification-documents') });
}

/** Multipart upload: field `file` + `documentType` (PDF, JPEG or PNG, max 10 MB). */
export function useUploadDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { documentType: DocumentType; file: File }) => {
      const form = new FormData();
      form.append('documentType', v.documentType);
      form.append('file', v.file);
      const res = await apiClient.post<ApiEnvelope<VerificationDocument>>('/verification-documents', form);
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.profile.documents }),
  });
}

export function downloadVerificationDocument(doc: Pick<VerificationDocument, 'id' | 'originalFilename'>) {
  return downloadFile(`/verification-documents/${doc.id}/file`, doc.originalFilename);
}
