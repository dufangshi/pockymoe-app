// The typed REST surface the screens use. Paths, queries and bodies follow the Web's
// apps/supervisor-web/src/lib/api.ts so both clients ask the Supervisor the same things.
import type {
  AgentBackendDto, AgentBackendIdDto, AgentCapabilitySnapshotDto, CreateThreadInput, InterruptTurnInput, ModelOptionDto, RelayPortalSummaryDto,
  RelaySessionDto, SendThreadPromptInput, ThreadActionRequestAnswerDto, ThreadDetailDto, ThreadDto, UpdateThreadSettingsInput,
  WorkspaceDto, ThreadHistoryItemDetailDto, ThreadTurnDto, PromptAttachmentManifestEntryDto,
} from '@pockymoe/shared';
import { relayUrl } from '@pockymoe/web/relayOrigin';
import { deviceFetch, type Target } from './transport';
import { multipart } from './multipart';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;
/** Network failures and gateway answers: worth a retry, not the user's fault. */
export function isConnectionError(error: unknown) {
  if (error instanceof ApiError) return [0, 502, 503, 504].includes(error.status) || error.code === 'device_unresponsive';
  return error instanceof TypeError || /network|fetch|timed? ?out|abort/i.test(String((error as Error)?.message ?? ''));
}

async function readError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let data: { code?: string; message?: string; error?: string } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* plain text */ }
  const code = data?.code ?? (response.status === 401 ? 'unauthorized' : response.status === 404 ? 'not_found' : `http_${response.status}`);
  return new ApiError(data?.message ?? data?.error ?? (text.slice(0, 200) || `HTTP ${response.status}`), response.status, code);
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Relay account endpoints (not device traffic). The session is the bearer token. */
export const relayApi = {
  async session() { return json<RelaySessionDto & { account?: unknown }>(await fetch(relayUrl('relay/auth/session'), { cache: 'no-store' })); },
  async portal() { return json<RelayPortalSummaryDto>(await fetch(relayUrl('relay/portal'), { cache: 'no-store' })); },
  async logout() { await fetch(relayUrl('relay/auth/logout'), { method: 'POST' }).catch(() => undefined); },
  async workbench() { return json<NavigationSnapshot>(await fetch(relayUrl('relay/account/workbench'), { cache: 'no-store' })); },
  async visit(reference: ThreadVisit) {
    return json<NavigationSnapshot>(await fetch(relayUrl('relay/account/workbench'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reference) }));
  },
};

export interface ThreadReference {
  deviceId: string | null; threadId: string; title: string; workspaceLabel: string; workspaceId?: string;
  favorite: boolean; favoriteOrder?: number | null; visitedAt: string; readCompletedAt?: string | null;
}
export interface NavigationSnapshot { threads: ThreadReference[]; notifications: unknown[] }
export interface ThreadVisit { deviceId: string | null; threadId: string; title: string; workspaceLabel: string; workspaceId?: string; favorite?: boolean; readCompletedAt?: string }

export interface SearchMatch {
  threadId: string; threadTitle: string; workspaceId: string; workspaceLabel: string; workspacePath: string;
  turnId: string | null; itemId: string | null; kind: 'title' | 'message'; role: string; text: string; createdAt: string;
}
/** Where a new thread's worktree goes; the device derives a missing name from the title. */
export interface ThreadWorktreeOptions { name?: string; branch?: string; base?: string; clientRequestId?: string }
/** `.pockymoe/worktree.json`'s outcome (null when the repository has none). */
export interface StartedWorktreeThread {
  thread: ThreadDto; worktree: { path: string; branch: string | null };
  setup: { completed: boolean; output?: string[]; error?: string } | null; created: boolean;
}
export interface HarnessTarget { provider: AgentBackendIdDto; agentId: string; model?: string | null; reasoningEffort?: string | null }
/** `POST …/harness/preview` (crates/runtime/src/service/handoff.rs `HandoffPreview`). */
export interface HarnessPreview { text: string; bytes: number; estimatedTokens: number; turns: number; omittedTurns: string[]; resumesSession: boolean; settingsNote?: string }
/** `GET /api/config/model-pricing`: the device's model catalog, keyed by model id. */
export interface ModelPricingCatalog { models?: Record<string, { inputUsdPerMillion?: unknown; outputUsdPerMillion?: unknown; contextWindowTokens?: unknown; aliases?: unknown; unpriced?: unknown }> }
export interface PromptAttachment { clientId: string; kind: 'photo' | 'file'; name: string; uri: string; mimeType: string; placeholder: string }

/** One device (a relay device or a direct Supervisor). */
export class DeviceApi {
  constructor(readonly target: Target) {}
  private async request<T>(path: string, init: RequestInit = {}, scope?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return json<T>(await deviceFetch(this.target, path, { ...init, headers }, scope));
  }
  private send<T>(method: string, path: string, body?: unknown) {
    return this.request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }

  version() { return this.request<{ version: string }>('/api/version'); }
  workspaces() { return this.request<WorkspaceDto[]>('/api/workspaces'); }
  threads(includeAgentThreads = true) { return this.request<ThreadDto[]>(`/api/threads${includeAgentThreads ? '?includeAgentThreads=true' : ''}`); }
  favoriteWorkspace(id: string, isFavorite: boolean) { return this.send<WorkspaceDto>('POST', `/api/workspaces/${id}/favorite`, { isFavorite }); }
  threadDetail(id: string, options: { limit?: number; beforeTurnId?: string } = {}) {
    const params = new URLSearchParams({ view: 'summary', limit: String(options.limit ?? 3), compact: '1', narration: '1' });
    if (options.beforeTurnId) params.set('beforeTurnId', options.beforeTurnId);
    return this.request<ThreadDetailDto>(`/api/threads/${id}?${params}`, {}, id);
  }
  /** Older turns, one page at a time (as the Web's conversation pages). */
  earlierTurns(id: string, beforeTurnId: string) {
    const params = new URLSearchParams({ view: 'full', limit: '20', compact: '1', beforeTurnId });
    return this.request<ThreadDetailDto>(`/api/threads/${encodeURIComponent(id)}?${params}`, {}, id);
  }
  itemDetail(id: string, itemId: string) { return this.request<ThreadHistoryItemDetailDto>(`/api/threads/${id}/items/${encodeURIComponent(itemId)}/detail`, {}, id); }
  turnDetail(id: string, turnId: string) { return this.request<ThreadTurnDto>(`/api/threads/${id}/turns/${encodeURIComponent(turnId)}/detail?compact=1`, {}, id); }
  createThread(input: CreateThreadInput & { environmentConnectionId?: string }) { return this.send<ThreadDto>('POST', '/api/threads/start', input); }
  /** A new thread in its own worktree (`POST /api/threads/start-worktree`, docs/worktrees.md). Owner only. */
  createThreadInWorktree(input: CreateThreadInput, worktree: ThreadWorktreeOptions) {
    return this.send<StartedWorktreeThread>('POST', '/api/threads/start-worktree', { ...input, worktree });
  }
  async prompt(id: string, input: SendThreadPromptInput, attachments: PromptAttachment[] = []) {
    if (!attachments.length) return this.send<ThreadDto>('POST', `/api/threads/${id}/prompt`, input);
    const fields: [string, string][] = [['prompt', input.prompt]];
    if (input.clientRequestId) fields.push(['clientRequestId', input.clientRequestId]);
    if (input.model) fields.push(['model', input.model]);
    if (input.reasoningEffort) fields.push(['reasoningEffort', input.reasoningEffort]);
    if (input.collaborationMode) fields.push(['collaborationMode', input.collaborationMode]);
    const manifest: PromptAttachmentManifestEntryDto[] = attachments.map(a => ({ clientId: a.clientId, kind: a.kind, originalName: a.name, placeholder: a.placeholder }));
    fields.push(['attachmentManifest', JSON.stringify(manifest)]);
    const { body, contentType } = await multipart(fields, attachments.map(a => ({ field: 'attachments', name: a.name, type: a.mimeType, uri: a.uri })));
    return this.request<ThreadDto>(`/api/threads/${id}/prompt`, { method: 'POST', body, headers: { 'content-type': contentType } });
  }
  interrupt(id: string, input: InterruptTurnInput = {}) { return this.send<ThreadDto>('POST', `/api/threads/${id}/interrupt`, input); }
  rename(id: string, title: string) { return this.send<ThreadDto>('PATCH', `/api/threads/${id}`, { title }); }
  deleteThread(id: string) { return this.send<void>('DELETE', `/api/threads/${id}`); }
  updateSettings(id: string, input: UpdateThreadSettingsInput) { return this.send<ThreadDto>('PATCH', `/api/threads/${id}/settings`, input); }
  cancelSteer(id: string, steerId: string) { return this.send<void>('DELETE', `/api/threads/${id}/pending-steers/${encodeURIComponent(steerId)}`); }
  steerNow(id: string, steerId: string) { return this.send<unknown>('POST', `/api/threads/${id}/pending-steers/${encodeURIComponent(steerId)}/steer`, {}); }
  /** Answers, or `allow` for a permission request without questions (as the Web's desktop shell). */
  respond(id: string, requestId: string, body: { answers: Record<string, ThreadActionRequestAnswerDto> } | { allow: boolean }) {
    return this.send<unknown>('POST', `/api/threads/${id}/requests/${encodeURIComponent(requestId)}/respond`, body);
  }
  runtimes() { return this.request<AgentBackendDto[]>('/api/agent-runtimes'); }
  runtimeModels(provider: AgentBackendIdDto, agentId?: string | null, cwd?: string | null) {
    const query = new URLSearchParams({ ...(agentId ? { agentId } : {}), ...(cwd ? { cwd } : {}) }).toString();
    const suffix = query ? `?${query}` : '';
    return this.request<ModelOptionDto[]>(`/api/agent-runtimes/${encodeURIComponent(provider)}/models${suffix}`);
  }
  /** What the thread's harness offers now (controls such as liveModelSwitch). */
  threadCapabilities(id: string) { return this.request<AgentCapabilitySnapshotDto>(`/api/threads/${encodeURIComponent(id)}/capabilities`, {}, id); }
  modelPricing() { return this.request<ModelPricingCatalog>('/api/config/model-pricing'); }
  runtimeAgents(provider: AgentBackendIdDto) { return this.request<ModelOptionDto[]>(`/api/agent-runtimes/${encodeURIComponent(provider)}/agents`); }
  threadModels(id: string) { return this.request<ModelOptionDto[]>(`/api/threads/${encodeURIComponent(id)}/models`, {}, id); }
  search(query: string, workspaceId?: string, offset = 0) {
    const path = workspaceId ? `/api/workspaces/${encodeURIComponent(workspaceId)}/search` : '/api/search';
    return this.request<{ matches: SearchMatch[]; hasMore: boolean; nextOffset: number | null }>(`${path}?${new URLSearchParams({ q: query, limit: '50', offset: String(offset) })}`);
  }
  /** Bytes of a thread image asset; the transport is sealed, so images are fetched, not linked. */
  async imageBytes(threadId: string, path: string) {
    const response = await deviceFetch(this.target, `/api/threads/${encodeURIComponent(threadId)}/assets/image?${new URLSearchParams({ path })}`, {}, threadId);
    if (!response.ok) throw await readError(response);
    return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('content-type') ?? 'image/png' };
  }
  /** Cross-harness switch (docs/harness-switching.md): preview first, then switch. */
  harnessPreview(id: string, target: HarnessTarget) { return this.send<HarnessPreview>('POST', `/api/threads/${id}/harness/preview`, target); }
  compact(id: string) { return this.send<ThreadDto>('POST', `/api/threads/${id}/compact`); }
  /** Ends the thread's harness session; with `interrupt`, after the running turn settles. */
  release(id: string, input: { interrupt?: boolean } = {}) { return this.send<unknown>('POST', `/api/threads/${id}/release`, input); }
  harnessSwitch(id: string, target: HarnessTarget) { return this.send<ThreadDto>('POST', `/api/threads/${id}/harness/switch`, target); }
  raw(path: string, init: RequestInit = {}) { return this.request<unknown>(path, init); }
}

/** Direct Supervisor sign-in with its optional passcode (`/api/auth/*`). */
export const directAuth = {
  async session(baseUrl: string, token: string | null) {
    return json<{ authenticated: boolean; mode: string; authRequired: boolean; passcode: boolean }>(
      await fetch(`${baseUrl}/api/auth/session`, { headers: token ? { authorization: `Bearer ${token}` } : {}, credentials: 'omit' }));
  },
  async login(baseUrl: string, password: string) {
    return json<{ token?: string; authenticated?: boolean }>(await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'owner', password }) }));
  },
};
