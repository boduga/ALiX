/** Serialized form of a durable builder's in-memory projection state. Must be a
 *  JSON-serializable plain object (no Maps/Sets/Dates/undefined) so it can ride
 *  in the checkpoint envelope. */
export type ProjectionState = Record<string, unknown>;

/** ProjectionStateSnapshot describes the SHAPE only. Runtime-produced
 *  snapshots (ProjectionRuntime.exportState) SHOULD use a null prototype
 *  because projection ids are external strings — treat them as a
 *  dictionary, not an object with inherited properties. Persisted JSON
 *  (checkpoint files) naturally reconstructs normal-prototype objects;
 *  do NOT "fix" JSON.parse output to a null prototype — the shape is what
 *  matters, not the prototype. Readonly: the runtime export advertises no
 *  mutability; consumers read, never assign. */
export type ProjectionStateSnapshot = Readonly<Record<string, ProjectionState>>;
