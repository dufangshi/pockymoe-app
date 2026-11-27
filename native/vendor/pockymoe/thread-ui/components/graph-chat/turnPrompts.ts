import { createContext, useContext } from 'react';

/** The turn a message belongs to: which prompt started it, its error if it
    failed, and the reply a fork from this turn ends with once it finished. */
export const TurnPromptContext = createContext<{
  firstPromptId: string;
  error: string | null;
  turnId?: string;
  forkReplyId?: string | null;
} | null>(null);

/** The error of the failed turn this prompt started. */
export function useTurnFailure(itemId: string) {
  const turn = useContext(TurnPromptContext);
  return turn?.firstPromptId === itemId ? turn.error : null;
}

/** The finished turn a fork ends at, when this reply is that turn's last one. */
export function useForkTurn(itemId: string) {
  const turn = useContext(TurnPromptContext);
  return turn?.forkReplyId === itemId ? turn.turnId ?? null : null;
}

/** Whether this prompt was added while the turn was already working. */
export function useAddedPrompt(itemId: string) {
  const turn = useContext(TurnPromptContext);
  return Boolean(turn && turn.firstPromptId !== itemId);
}

/** The readable part of an error such as `ACP session/prompt failed: {"code":…,"message":"Internal error: …"}`. */
export function failureMessage(error: string) {
  const start = error.indexOf('{');
  if (start >= 0) {
    try {
      const parsed = JSON.parse(error.slice(start)) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.replace(/^Internal error:\s*/, '').trim();
    } catch { /* not JSON */ }
  }
  return error.trim();
}

/** A reply that only repeats its turn's error, like the one Claude writes for an API error. */
export function echoesFailure(error: string, text: string) {
  const reply = text.trim();
  return reply.length >= 8 && (error.includes(reply) || failureMessage(error).includes(reply));
}

export function useEditTurn(itemId: string) {
  const turn = useContext(TurnPromptContext);
  return turn?.firstPromptId === itemId ? turn.turnId : undefined;
}
