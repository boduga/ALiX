import { performance } from 'node:perf_hooks'
import { TerminalCanvas } from '../../dist/src/interfaces/tui/canvas.js'
import { withTestRenderer } from './harness.mjs'
import { WORKBENCH } from './workbench-fixture.mjs'
import { mountWorkbench } from './static-workbench.mjs'

// Diagnostic microbenchmark only. ANSI and OpenTUI do different work, so no
// number here is a parity verdict; see README "Benchmark limitations".
const frames = Number(process.env.FRAMES ?? 200)
const updates = Number(process.env.UPDATES ?? 5000)
const rounds = Number(process.env.ROUNDS ?? 6)
const updatesPerRound = Number(process.env.UPDATES_PER_ROUND ?? 2000)
const burst = Number(process.env.BURST ?? 500)

// Provisional rollout thresholds, derived from measured headroom on this fixed
// fixture (see README "Performance thresholds"). Absolute "no pathological"
// bounds, not ANSI/OpenTUI parity. Pending operator sign-off.
const THRESHOLDS = {
  idleCpuMsPerSecondMax: 150,
  inputToRenderP95MsMax: 16,
  netGrowthMiBMax: 32,
  tailSlopeMiBPerRoundMax: 4,
  burstCoalesceFactor: 10,
}

function ansiFrame(value) {
  const canvas = new TerminalCanvas(120, 30)
  canvas.drawBox(0, 0, 28, 24, 'Agents')
  canvas.drawBox(28, 0, 62, 24, 'Transcript')
  canvas.drawBox(90, 0, 30, 24, 'Inspector')
  canvas.drawBox(0, 24, 120, 3, 'Composer')
  canvas.drawBox(0, 27, 120, 3, 'Footer')
  WORKBENCH.roster.split('\n').forEach((row, i) => canvas.write(2, 2 + i, row))
  canvas.write(30, 2, `Frontend: ${value}`)
  canvas.write(92, 2, WORKBENCH.inspector.split('\n')[0])
  canvas.write(2, 25, WORKBENCH.composerPlaceholder)
  canvas.write(2, 28, WORKBENCH.footer)
  return canvas.renderFrame()
}

const ansiStart = performance.now()
for (let i = 0; i < frames; i++) ansiFrame(i)
const ansiMs = performance.now() - ansiStart

const result = await withTestRenderer({ width: 120, height: 30 }, async (setup) => {
  const { input } = mountWorkbench(setup.renderer)
  input.focus()
  await setup.renderOnce()

  const openStart = performance.now()
  for (let i = 0; i < frames; i++) {
    input.value = `Frontend: ${i}`
    await setup.renderOnce()
  }
  const openMs = performance.now() - openStart

  // Idle CPU with no input for one second.
  const idleCpuBefore = process.cpuUsage()
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const idleCpu = process.cpuUsage(idleCpuBefore)

  // Input-to-render latency over `updates` bounded keystrokes.
  const latencies = []
  const inputStart = performance.now()
  for (let i = 0; i < updates; i++) {
    if (i % 20 === 0) input.value = ''
    const start = performance.now()
    setup.mockInput.pressKey('a')
    await setup.renderOnce()
    latencies.push(performance.now() - start)
  }
  const inputMs = performance.now() - inputStart
  latencies.sort((a, b) => a - b)

  // Steady-state RSS: `rounds` tranches of `updatesPerRound` merges, sampled
  // after an explicit GC so a plateau (flat deltas) is distinguishable from
  // unbounded growth.
  const rssSamplesMiB = []
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < updatesPerRound; i++) {
      input.value = ''
      setup.mockInput.pressKey('a')
      await setup.renderOnce()
    }
    global.gc()
    global.gc()
    rssSamplesMiB.push(Math.round(process.memoryUsage().rss / 1048576))
  }
  const rssDeltasMiB = rssSamplesMiB.slice(1).map((v, i) => v - rssSamplesMiB[i])
  const netGrowthMiB = rssSamplesMiB.at(-1) - rssSamplesMiB[0]
  const tail = rssSamplesMiB.slice(1)
  const tailXMean = tail.length ? tail.reduce((acc, _, i) => acc + (i + 1), 0) / tail.length : 0
  const tailYMean = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : 0
  const tailNum = tail.reduce((acc, v, i) => acc + (i + 1 - tailXMean) * (v - tailYMean), 0)
  const tailDen = tail.reduce((acc, _, i) => acc + (i + 1 - tailXMean) ** 2, 0)
  const tailSlopeMiBPerRound = tailDen ? +(tailNum / tailDen).toFixed(2) : 0

  // Streaming frame backlog: fire many render requests without awaiting; the
  // scheduler must coalesce them into pending flags, not an unbounded queue.
  // Frames are sampled after idle() drains the burst, before the settle
  // renderOnce(), so the burst count excludes that manual frame.
  const framesBeforeBurst = setup.getNativeStats().nativeFrameCount
  for (let i = 0; i < burst; i++) {
    input.value = ''
    setup.mockInput.pressKey('a')
    setup.renderer.requestRender()
  }
  const scheduledDuringBurst = setup.renderer.getSchedulerState().hasScheduledRender
  await setup.renderer.idle()
  const framesAfterBurst = setup.getNativeStats().nativeFrameCount
  const hasScheduledAfterDrain = setup.renderer.getSchedulerState().hasScheduledRender
  await setup.renderOnce()
  const framesRenderedForBurst = framesAfterBurst - framesBeforeBurst

  const idleCpuMsPerSecond = +((idleCpu.user + idleCpu.system) / 1000).toFixed(1)
  const p50Ms = +latencies[Math.floor(updates * 0.5)].toFixed(2)
  const p95Ms = +latencies[Math.floor(updates * 0.95)].toFixed(2)
  const maxBurstFrames = Math.max(1, Math.floor(burst / THRESHOLDS.burstCoalesceFactor))

  const thresholdChecks = [
    {
      name: 'idleCpuMsPerSecond',
      value: idleCpuMsPerSecond,
      limit: `<= ${THRESHOLDS.idleCpuMsPerSecondMax}`,
      ok: idleCpuMsPerSecond <= THRESHOLDS.idleCpuMsPerSecondMax,
    },
    {
      name: 'inputToRenderP95Ms',
      value: p95Ms,
      limit: `<= ${THRESHOLDS.inputToRenderP95MsMax}`,
      ok: p95Ms <= THRESHOLDS.inputToRenderP95MsMax,
    },
    {
      name: 'netGrowthMiB(abs)',
      value: netGrowthMiB,
      limit: `<= ${THRESHOLDS.netGrowthMiBMax}`,
      ok: Math.abs(netGrowthMiB) <= THRESHOLDS.netGrowthMiBMax,
    },
    {
      name: 'tailSlopeMiBPerRound(abs)',
      value: tailSlopeMiBPerRound,
      limit: `<= ${THRESHOLDS.tailSlopeMiBPerRoundMax}`,
      ok: Math.abs(tailSlopeMiBPerRound) <= THRESHOLDS.tailSlopeMiBPerRoundMax,
    },
    {
      name: 'burstFramesRendered',
      value: framesRenderedForBurst,
      limit: `<= ${maxBurstFrames} (and no residual scheduled render)`,
      ok: framesRenderedForBurst <= maxBurstFrames && !hasScheduledAfterDrain,
    },
  ]

  return {
    runtime: process.version,
    fixture: `120x30, four agents, ${frames} full frames, ${updates} input updates`,
    fullFrame: {
      ansiCanvasPaintAndSerializeMsTotal: +ansiMs.toFixed(1),
      ansiCanvasPaintAndSerializeMsPerFrame: +(ansiMs / frames).toFixed(3),
      openTuiRenderMsTotal: +openMs.toFixed(1),
      openTuiRenderMsPerFrame: +(openMs / frames).toFixed(3),
    },
    inputToRender: {
      updates,
      totalMs: +inputMs.toFixed(1),
      p50Ms,
      p95Ms,
    },
    idleCpuMsPerSecond,
    steadyStateRss: {
      rounds,
      updatesPerRound,
      samplesMiB: rssSamplesMiB,
      deltasMiB: rssDeltasMiB,
      netGrowthMiB,
      tailSlopeMiBPerRound,
    },
    frameBacklog: {
      requestsFired: burst,
      framesRenderedForBurst,
      coalesced: burst - framesRenderedForBurst,
      hasScheduledRenderDuring: scheduledDuringBurst,
      hasScheduledRenderAfterDrain: hasScheduledAfterDrain,
    },
    thresholds: { provisional: true, pendingOperatorSignoff: true, ...THRESHOLDS },
    verdict: { passed: thresholdChecks.every((c) => c.ok), checks: thresholdChecks },
    limitations: 'ANSI paint/serialize and OpenTUI native render/transport do different work; compare shapes, not absolutes. Single Linux host, one run.',
  }
})

console.log(JSON.stringify(result, null, 2))
