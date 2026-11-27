// Live thread events applied to a loaded detail; pure, so tests run it directly.
import { mergeThreadHistoryItem } from '@pockymoe/shared';
import type { ThreadDetailDto, ThreadEventEnvelope, ThreadHistoryItemDto, ThreadTurnDto } from '@pockymoe/shared';

function upsertItem(turn: ThreadTurnDto, item: ThreadHistoryItemDto): ThreadTurnDto {
  const index = turn.items.findIndex(i => i.id === item.id);
  const items = turn.items.slice();
  if (index < 0) items.push(item); else items[index] = mergeThreadHistoryItem(items[index], item);
  return { ...turn, items };
}
function withTurn(detail: ThreadDetailDto, turnId: string, update: (turn: ThreadTurnDto) => ThreadTurnDto): ThreadDetailDto {
  const index = detail.turns.findIndex(t => t.id === turnId);
  const turns = detail.turns.slice();
  if (index < 0) turns.push(update({ id: turnId, startedAt: new Date().toISOString(), status: 'inProgress', error: null, items: [] }));
  else turns[index] = update(turns[index]!);
  return { ...detail, turns };
}

/** Applies one live event. Exported for tests. */
export function applyThreadEvent(detail: ThreadDetailDto, event: ThreadEventEnvelope): ThreadDetailDto {
  switch (event.type) {
    case 'thread.turn.started':
      return { ...withTurn(detail, event.payload.turnId, t => ({ ...t, status: 'inProgress' })), thread: { ...detail.thread, status: 'running', activeTurnId: event.payload.turnId } };
    case 'thread.item.started':
    case 'thread.item.completed':
      return withTurn(detail, event.payload.turnId, t => upsertItem(t, event.payload.item));
    case 'thread.output.delta': {
      const p = event.payload;
      return withTurn(detail, p.turnId, t => {
        const current = t.items.find(i => i.id === p.itemId);
        if (current && (current.sequence ?? -1) >= p.sequence && p.text === undefined) return t;
        const text = p.text ?? `${current?.text ?? ''}${p.delta}`;
        const item: ThreadHistoryItemDto = { ...(current ?? { id: p.itemId, kind: 'agentMessage', createdAt: p.createdAt ?? event.timestamp, status: 'inProgress' }), text, sequence: p.sequence } as ThreadHistoryItemDto;
        const items = current ? t.items.map(i => i.id === p.itemId ? item : i) : [...t.items, item];
        return { ...t, items };
      });
    }
    case 'thread.turn.completed':
      return { ...withTurn(detail, event.payload.turnId, t => ({ ...t, status: event.payload.status, error: event.payload.error, completedAt: event.timestamp })),
        thread: { ...detail.thread, status: event.payload.status === 'failed' ? 'failed' : event.payload.status === 'interrupted' ? 'interrupted' : 'idle', activeTurnId: null, lastTurnCompletedAt: event.timestamp } };
    case 'thread.turn.failed':
      return withTurn(detail, event.payload.turnId, t => ({ ...t, error: event.payload.error, ...(event.payload.willRetry ? {} : { status: 'failed' as const }) }));
    case 'thread.updated': {
      const p = event.payload;
      return { ...detail, ...(p.pendingSteers ? { pendingSteers: p.pendingSteers } : {}), thread: { ...detail.thread,
        ...(p.title ? { title: p.title } : {}), ...(p.status ? { status: p.status as ThreadDetailDto['thread']['status'] } : {}),
        ...(p.model !== undefined ? { model: p.model } : {}), ...(p.reasoningEffort !== undefined ? { reasoningEffort: p.reasoningEffort } : {}),
        ...(p.fastMode !== undefined ? { fastMode: p.fastMode } : {}) } };
    }
    case 'thread.request.created':
      return detail.pendingRequests.some(r => r.id === event.payload.request.id) ? detail : { ...detail, pendingRequests: [...detail.pendingRequests, event.payload.request] };
    case 'thread.request.resolved':
      return { ...detail, pendingRequests: detail.pendingRequests.filter(r => r.id !== event.payload.requestId) };
    case 'thread.plan.updated':
      return { ...detail, livePlan: { turnId: event.payload.turnId, explanation: event.payload.explanation, plan: event.payload.plan } as ThreadDetailDto['livePlan'] };
    case 'thread.turn.token.updated':
      return withTurn(detail, event.payload.turnId, t => ({ ...t, tokenUsage: event.payload.tokenUsage, priceEstimate: event.payload.priceEstimate,
        ...(event.payload.model ? { model: event.payload.model } : {}) }));
    case 'thread.subagents.updated': return { ...detail, activeSubagents: event.payload.activeSubagents };
    case 'thread.context.updated': return { ...detail, thread: { ...detail.thread, contextUsage: event.payload.contextUsage } };
    case 'thread.goal.updated': return { ...detail, goal: event.payload.goal, goalHistory: event.payload.goalHistory };
    case 'thread.goal.cleared': return { ...detail, goal: null, goalHistory: event.payload.goalHistory };
    default: return detail;
  }
}

