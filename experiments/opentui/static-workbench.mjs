import { BoxRenderable, InputRenderable, TextRenderable, createCliRenderer } from '@opentui/core'

export function mountWorkbench(renderer) {
  const shell = new BoxRenderable(renderer, { width: '100%', height: '100%', flexDirection: 'column' })
  const panes = new BoxRenderable(renderer, { width: '100%', flexGrow: 1, flexDirection: 'row' })
  const agents = new BoxRenderable(renderer, { width: '23%', height: '100%', border: true, title: 'Agents' })
  const transcript = new BoxRenderable(renderer, { width: '52%', height: '100%', border: true, title: 'Transcript' })
  const inspector = new BoxRenderable(renderer, { width: '25%', height: '100%', border: true, title: 'Inspector' })
  agents.add(new TextRenderable(renderer, { content: 'orchestrator  RUNNING\nfrontend      RUNNING\nbackend       WAITING\ntests         READY' }))
  transcript.add(new TextRenderable(renderer, { content: 'ALL  RESPONSE  TOOL  ACTIVITY\n\nOrchestrator: Four-worker fixture\nFrontend: Building UI\nBackend: Waiting on contract' }))
  inspector.add(new TextRenderable(renderer, { content: 'AGENT DETAILS\nfrontend\n\nLIVE ACTIVITY\nBuilding UI\n\nAPPROVALS 0\nARTIFACTS 1' }))
  panes.add(agents)
  panes.add(transcript)
  panes.add(inspector)
  const composer = new BoxRenderable(renderer, { width: '100%', height: 3, border: true, title: 'Composer' })
  const input = new InputRenderable(renderer, { width: '100%', placeholder: 'Add your next instruction...' })
  composer.add(input)
  const footer = new BoxRenderable(renderer, { width: '100%', height: 3, border: true, title: 'Footer' })
  footer.add(new TextRenderable(renderer, { content: 'TOKENS 7.3k | AGENTS 4 | BLOCKED 1 | HEALTH OK' }))
  shell.add(panes)
  shell.add(composer)
  shell.add(footer)
  renderer.root.add(shell)
  return { shell, input }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, exitSignals: [] })
  try {
    const { input } = mountWorkbench(renderer)
    input.focus()
    await renderer.idle()
    await new Promise((resolve) => {
      renderer.keyInput.on('keypress', (key) => {
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) resolve()
      })
    })
  } finally {
    renderer.destroy()
    await renderer.closed
  }
}
