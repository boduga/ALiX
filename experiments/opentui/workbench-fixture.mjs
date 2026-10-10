// Single source of the static four-agent Workbench fixture data. Shared by the
// OpenTUI renderable fixture, the ANSI comparison frame, and the frame
// assertions so the roster/transcript/inspector text cannot drift between them.
export const WORKBENCH = Object.freeze({
  regionTitles: ['Agents', 'Transcript', 'Inspector', 'Composer', 'Footer'],
  agentNames: ['orchestrator', 'frontend', 'backend', 'tests'],
  roster: 'orchestrator  RUNNING\nfrontend      RUNNING\nbackend       WAITING\ntests         READY',
  transcript:
    'ALL  RESPONSE  TOOL  ACTIVITY\n\nOrchestrator: Four-worker fixture\nFrontend: Building UI\nBackend: Waiting on contract',
  inspector: 'AGENT DETAILS\nfrontend\n\nLIVE ACTIVITY\nBuilding UI\n\nAPPROVALS 0\nARTIFACTS 1',
  composerPlaceholder: 'Add your next instruction...',
  footer: 'TOKENS 7.3k | AGENTS 4 | BLOCKED 1 | HEALTH OK',
})
