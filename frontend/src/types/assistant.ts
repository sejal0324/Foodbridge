export type AssistantMode = 'LLM' | 'DIRECT' | 'FALLBACK' | 'UNAVAILABLE';

export interface AssistantSuggestion {
  text: string;
  intent: string;
}

export interface AssistantCard {
  tool: string;
  title: string;
  data: unknown;
  link?: string;
}

export interface PendingAction {
  id: number;
  tool: string;
  summary: string;
  payload: Record<string, unknown>;
  expiresInMinutes: number;
}

/** POST /api/ai/chat */
export interface ChatResponse {
  conversationId: string;
  mode: AssistantMode;
  message: string;
  cards: AssistantCard[];
  pendingAction: PendingAction | { error: string } | null;
  suggestions?: AssistantSuggestion[];
  provider?: string;
  model?: string;
}

export interface ChatInput {
  message: string;
  conversationId?: string;
  intent?: string;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/ai/conversations/:id/messages item. */
export interface ConversationMessage {
  id: number;
  role: 'USER' | 'ASSISTANT';
  content: string | null;
  toolName: string | null;
  pendingAction: { tool: string; payload: Record<string, unknown> } | null;
  actionStatus: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'FAILED' | null;
  status: string;
  createdAt: string;
}
