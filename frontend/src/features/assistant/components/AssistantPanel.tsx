import { Bot, MessageSquarePlus, Send, Sparkles, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, Banner, Button, EmptyState, ErrorState, SkeletonList, Textarea } from '@/components/ui';
import { ApiError } from '@/services/apiError';
import type { AssistantCard, AssistantMode, AssistantSuggestion, ConversationMessage, PendingAction, Role } from '@/types';
import { cn } from '@/utils/cn';
import { formatRelative } from '@/utils/format';
import { useAssistantSuggestions, useConversationMessages, useConversations, useSendChat } from '../api';
import { PendingActionCard, type ActionStatus } from './PendingActionCard';
import { ResultCard } from './ResultCards';

interface UiMessage {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: AssistantMode;
  cards?: AssistantCard[];
  action?: { id: number; summary: string; payload: Record<string, unknown>; status: ActionStatus; expiresInMinutes?: number };
  error?: string;
  retry?: { message: string; intent?: string };
}

const MODE_LABEL: Record<AssistantMode, { label: string; tone: 'neutral' | 'info' | 'warning' | 'danger' }> = {
  LLM: { label: 'AI answer from your data', tone: 'neutral' },
  DIRECT: { label: 'Direct result', tone: 'info' },
  FALLBACK: { label: 'AI unavailable: direct result', tone: 'warning' },
  UNAVAILABLE: { label: 'Assistant unavailable', tone: 'danger' },
};

function fromHistory(rows: ConversationMessage[]): UiMessage[] {
  return rows.map((r) => {
    if (r.role === 'ASSISTANT' && r.pendingAction) {
      return {
        key: `h${r.id}`,
        role: 'assistant',
        text: 'I drafted this for you to review:',
        action: { id: r.id, summary: `${r.pendingAction.tool.replace(/_/g, ' ')}`, payload: r.pendingAction.payload, status: (r.actionStatus ?? 'PENDING') as ActionStatus },
      };
    }
    return { key: `h${r.id}`, role: r.role === 'USER' ? 'user' : 'assistant', text: r.content ?? '' };
  });
}

function isPendingAction(p: unknown): p is PendingAction {
  return typeof p === 'object' && p !== null && typeof (p as PendingAction).id === 'number' && typeof (p as PendingAction).summary === 'string';
}

/**
 * The FoodBridge assistant (shared by donor, NGO and admin areas): conversation
 * history, suggested questions, structured result cards with in-app links, and
 * confirmation cards for any action that would change data.
 */
export function AssistantPanel({ role }: { role: Role }) {
  const conversations = useConversations();
  const suggestions = useAssistantSuggestions();
  const send = useSendChat();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, UiMessage[]>>({});
  const [historyCutoff, setHistoryCutoff] = useState<Record<string, number>>({});
  const [draftKey, setDraftKey] = useState(0);
  const [input, setInput] = useState('');
  const history = useConversationMessages(activeId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const slot = activeId ?? `new-${draftKey}`;
  const messages = useMemo(() => {
    const fromServer = activeId && history.data ? fromHistory(history.data) : [];
    const cutoff = activeId ? historyCutoff[activeId] : undefined;
    return [...(cutoff !== undefined ? fromServer.slice(0, cutoff) : fromServer), ...(live[slot] ?? [])];
  }, [activeId, history.data, historyCutoff, live, slot]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, send.isPending]);

  const append = (key: string, ...items: UiMessage[]) => setLive((l) => ({ ...l, [key]: [...(l[key] ?? []), ...items] }));

  const ask = (message: string, intent?: string) => {
    const text = message.trim();
    if (!text || send.isPending) return;
    const startSlot = slot;
    if (activeId && historyCutoff[activeId] === undefined) setHistoryCutoff((c) => ({ ...c, [activeId]: history.data?.length ?? 0 }));
    append(startSlot, { key: `u${Date.now()}`, role: 'user', text });
    setInput('');
    send.mutate(
      { message: text, ...(activeId ? { conversationId: activeId } : {}), ...(intent ? { intent } : {}) },
      {
        onSuccess: (res) => {
          const reply: UiMessage = {
            key: `a${Date.now()}`,
            role: 'assistant',
            text: res.message,
            mode: res.mode,
            cards: res.cards.filter((c) => !(isPendingAction(res.pendingAction) && c.data === res.pendingAction)),
            action: isPendingAction(res.pendingAction)
              ? { id: res.pendingAction.id, summary: res.pendingAction.summary, payload: res.pendingAction.payload, status: 'PENDING', expiresInMinutes: res.pendingAction.expiresInMinutes }
              : undefined,
            error: res.pendingAction && !isPendingAction(res.pendingAction) && 'error' in res.pendingAction ? res.pendingAction.error : undefined,
          };
          if (!activeId) {
            // A new conversation: move the draft messages under the server id.
            setLive((l) => {
              const { [startSlot]: draft = [], ...rest } = l;
              return { ...rest, [res.conversationId]: [...draft, reply] };
            });
            setHistoryCutoff((c) => ({ ...c, [res.conversationId]: 0 }));
            setActiveId(res.conversationId);
          } else append(startSlot, reply);
        },
        onError: (err) => append(startSlot, { key: `e${Date.now()}`, role: 'assistant', text: '', error: ApiError.from(err).message, retry: { message: text, intent } }),
      },
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  const updateActionStatus = (key: string, status: ActionStatus) =>
    setLive((l) => ({ ...l, [slot]: (l[slot] ?? []).map((m) => (m.key === key && m.action ? { ...m, action: { ...m.action, status } } : m)) }));

  const chips: AssistantSuggestion[] = suggestions.data ?? [];

  return (
    <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="flex flex-col rounded-2xl border border-white/10 bg-surface" aria-label="Conversations">
        <div className="border-b border-white/10 p-3">
          <Button
            variant="secondary"
            fullWidth
            leftIcon={<MessageSquarePlus className="size-4" aria-hidden="true" />}
            onClick={() => {
              setActiveId(null);
              setDraftKey((k) => k + 1);
            }}
          >
            New conversation
          </Button>
        </div>
        <div className="max-h-64 flex-1 overflow-y-auto p-2 lg:max-h-none">
          {conversations.isPending ? (
            <SkeletonList rows={3} />
          ) : conversations.isError ? (
            <ErrorState error={conversations.error} compact onRetry={() => void conversations.refetch()} />
          ) : conversations.data.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No conversations yet.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    aria-current={c.id === activeId ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-400',
                      c.id === activeId ? 'bg-brand-600/15 text-white' : 'text-slate-300 hover:bg-white/5',
                    )}
                  >
                    <span className="block truncate">{c.title ?? 'Conversation'}</span>
                    <span className="block text-xs text-slate-500">{formatRelative(c.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-h-[60vh] flex-col rounded-2xl border border-white/10 bg-surface" aria-label="Assistant chat">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite" aria-busy={send.isPending}>
          {activeId && history.isPending ? <SkeletonList rows={2} /> : null}
          {activeId && history.isError ? <ErrorState error={history.error} compact onRetry={() => void history.refetch()} /> : null}
          {messages.length === 0 && !(activeId && history.isPending) ? (
            <EmptyState
              icon={<Sparkles className="size-6" aria-hidden="true" />}
              title="Ask about your FoodBridge data"
              description="The assistant answers only from your own records through permission-checked tools. It cannot change anything without your confirmation."
            />
          ) : null}
          {messages.map((m) => (
            <MessageBubble key={m.key} m={m} role={role} onRetry={m.retry ? () => ask(m.retry?.message ?? '', m.retry?.intent) : undefined} onActionStatus={(s) => updateActionStatus(m.key, s)} />
          ))}
          {send.isPending ? (
            <div className="flex items-center gap-3" role="status" aria-label="Assistant is typing">
              <span className="grid size-8 place-items-center rounded-full bg-brand-600/20 text-brand-200">
                <Bot className="size-4" aria-hidden="true" />
              </span>
              <span className="flex gap-1 rounded-2xl bg-white/5 px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-pulse-dot rounded-full bg-slate-300" style={{ animationDelay: `${i * 0.18}s` }} />
                ))}
              </span>
            </div>
          ) : null}
        </div>

        <div className="border-t border-white/10 p-3 sm:p-4">
          {chips.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2" aria-label="Suggested questions">
              {chips.map((s) => (
                <button
                  key={s.text}
                  type="button"
                  disabled={send.isPending}
                  onClick={() => ask(s.text, s.intent)}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-brand-400/40 hover:bg-brand-600/10 hover:text-white focus-visible:outline-2 focus-visible:outline-brand-400 disabled:opacity-50"
                >
                  {s.text}
                </button>
              ))}
            </div>
          ) : null}
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <label htmlFor="assistant-input" className="sr-only">
              Message the assistant
            </label>
            <Textarea
              id="assistant-input"
              rows={1}
              value={input}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
              placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
              className="max-h-40 min-h-10 resize-y"
            />
            <Button type="submit" size="icon" aria-label="Send message" disabled={!input.trim()} loading={send.isPending}>
              {send.isPending ? null : <Send className="size-4" aria-hidden="true" />}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}

function MessageBubble({ m, role, onRetry, onActionStatus }: { m: UiMessage; role: Role; onRetry?: () => void; onActionStatus: (s: ActionStatus) => void }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end gap-3">
        <p className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">{m.text}</p>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-slate-300">
          <User className="size-4" aria-hidden="true" />
          <span className="sr-only">You</span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600/20 text-brand-200">
        <Bot className="size-4" aria-hidden="true" />
        <span className="sr-only">Assistant</span>
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        {m.error && !m.text ? (
          <Banner
            tone="danger"
            title="The assistant could not answer"
            actions={
              onRetry ? (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  Try again
                </Button>
              ) : null
            }
          >
            {m.error}
          </Banner>
        ) : (
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white/5 px-4 py-2.5">
            <p className="text-sm whitespace-pre-wrap text-slate-100">{m.text}</p>
            {m.mode ? (
              <Badge tone={MODE_LABEL[m.mode].tone} className="mt-2">
                {MODE_LABEL[m.mode].label}
              </Badge>
            ) : null}
          </div>
        )}
        {m.error && m.text ? <p className="text-xs text-amber-300">{m.error}</p> : null}
        {m.cards?.map((c, i) => (
          <ResultCard key={`${c.tool}-${i}`} card={c} role={role} />
        ))}
        {m.action ? (
          <PendingActionCard actionId={m.action.id} summary={m.action.summary} payload={m.action.payload} status={m.action.status} expiresInMinutes={m.action.expiresInMinutes} onStatusChange={onActionStatus} />
        ) : null}
      </div>
    </div>
  );
}
