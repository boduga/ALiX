/** One foreground owner per session, including initialization and chat. */
const activeTurns = new WeakSet<object>();

export function acquireSessionTurn(state: object): () => void {
  if (activeTurns.has(state)) throw new Error('Session is busy with an active turn.');
  activeTurns.add(state);
  return () => { activeTurns.delete(state); };
}
