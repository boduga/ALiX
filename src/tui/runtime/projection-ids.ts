/** Canonical projection ids — prevents silent string drift across the
 *  composition root, the collector's snapshot assembly, and tests. */
export const ProjectionIds = {
  timeline: 'timeline',
  trace: 'trace',
  approval: 'approval',
  capability: 'capability',
  metrics: 'metrics',
  context: 'context',
} as const;
