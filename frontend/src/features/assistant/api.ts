import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/services/apiClient';
import { qk } from '@/services/queryKeys';
import type { AssistantSuggestion, ChatInput, ChatResponse, ConversationMessage, ConversationSummary } from '@/types';

export function useAssistantSuggestions() {
  return useQuery({ queryKey: qk.assistant.suggestions, queryFn: () => apiGet<AssistantSuggestion[]>('/ai/suggestions'), staleTime: 60 * 60_000 });
}

export function useConversations() {
  return useQuery({ queryKey: qk.assistant.conversations, queryFn: () => apiGet<ConversationSummary[]>('/ai/conversations') });
}

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: qk.assistant.messages(conversationId ?? ''),
    queryFn: () => apiGet<ConversationMessage[]>(`/ai/conversations/${conversationId}/messages`),
    enabled: Boolean(conversationId),
  });
}

export function useSendChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChatInput) => apiPost<ChatResponse>('/ai/chat', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.assistant.conversations }),
  });
}

/** Confirms a pending assistant action (the backend executes it with the user's own permissions). */
export function useConfirmAssistantAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionId: number) => apiPost<unknown>(`/ai/actions/${actionId}/confirm`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.assistance.all });
      void qc.invalidateQueries({ queryKey: ['assistant', 'messages'] });
    },
  });
}

export function useCancelAssistantAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (actionId: number) => apiPost(`/ai/actions/${actionId}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assistant', 'messages'] }),
  });
}
