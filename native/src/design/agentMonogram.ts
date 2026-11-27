// Monograms for agents a theme gives no art (the Web's AgentChip).
const MONOGRAMS: Record<string, string> = {
  claude: 'Cl', codex: 'Cx', copilot: 'Co', cursor: 'Cu', deepseek: 'DS', gemini: 'Ge', grok: 'Gk', kimi: 'Ki', opencode: 'OC', qwen: 'Qw',
};

export const agentMonogram = (key: string) => MONOGRAMS[key] ?? key.replace(/[^a-z0-9]/gi, '').slice(0, 2).replace(/^./, c => c.toUpperCase());
