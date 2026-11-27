// OVERLAY (native): the settings type that the vendored pr/api.ts names from the Web's
// ReviewSettings.tsx (a DOM component, not vendored). Same shape as upstream.
export interface ReviewSettingsValue {
  removeAgentCredits: boolean;
  guideInstructions: string;
  guideWorkspaceInstructions: Record<string, string>;
  guideSource: 'auto' | 'codex' | 'claude' | 'upstream';
  guideModel: string;
}
