import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import sharp from "sharp"
import { KicadToCircuitJsonConverter } from "../../../lib"

const POINT_KEY_PRECISION = 1e6

const getPointKey = (point: { x: number; y: number }) => {
  const x = Math.round(point.x * POINT_KEY_PRECISION)
  const y = Math.round(point.y * POINT_KEY_PRECISION)
  return `${x},${y}`
}

test("highlights Arduino Uno standalone pcb_vias not represented in trace routes", async () => {
  const kicadPcbContent = readFileSync(
    "tests/repros/repro02-arduino-uno/arduino-uno.source.kicad_pcb",
    "utf-8",
  )

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("arduino-uno.kicad_pcb", kicadPcbContent)
  converter.runUntilFinished()

  const circuitJson = converter.getOutput()
  const pcbTraces = circuitJson.filter(
    (element: any) => element.type === "pcb_trace",
  ) as any[]
  const pcbVias = circuitJson.filter(
    (element: any) => element.type === "pcb_via",
  ) as any[]
  const routeVias = pcbTraces.flatMap((trace) =>
    trace.route.filter((routePoint: any) => routePoint.route_type === "via"),
  )
  const traceRoutePointKeys = new Set(
    pcbTraces.flatMap((trace) =>
      trace.route.map((routePoint: any) => getPointKey(routePoint)),
    ),
  )
  const unconnectedPcbVias = pcbVias.filter(
    (via) => !traceRoutePointKeys.has(getPointKey(via)),
  )
  const standalonePcbViasOnTraceRoute = pcbVias.filter((via) =>
    traceRoutePointKeys.has(getPointKey(via)),
  )

  expect(routeVias).toHaveLength(39)
  expect(pcbVias).toHaveLength(36)
  expect(unconnectedPcbVias).toHaveLength(33)
  expect(standalonePcbViasOnTraceRoute).toHaveLength(3)

  const baseSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
    showCourtyards: true,
  })
  const transform = inferPcbSvgTransform({
    svg: baseSvg,
    pcbVias,
  })
  const overlaySvg = addViaOverlayToSvg({
    svg: baseSvg,
    transform,
    routeVias,
    unconnectedPcbVias,
    standalonePcbViasOnTraceRoute,
  })

  expectSvgSnapshot(overlaySvg, import.meta.path, "arduino-uno-via-overlay")
  await writePngArtifact({
    svg: overlaySvg,
    testPath: import.meta.path,
    artifactName: "arduino-uno-via-overlay",
  })
})

function expectSvgSnapshot(
  svg: string,
  testPath: string,
  snapshotName: string,
) {
  const normalizedSvg = normalizeTransientSvgIds(svg)
  const snapshotDir = path.join(path.dirname(testPath), "__snapshots__")
  const snapshotPath = path.join(snapshotDir, `${snapshotName}.snap.svg`)
  const shouldUpdateSnapshot =
    process.argv.includes("--update-snapshots") ||
    process.argv.includes("-u") ||
    Boolean(process.env["BUN_UPDATE_SNAPSHOTS"])

  if (!existsSync(snapshotDir)) {
    mkdirSync(snapshotDir, { recursive: true })
  }

  if (!existsSync(snapshotPath) || shouldUpdateSnapshot) {
    writeFileSync(snapshotPath, normalizedSvg)
  }

  expect(normalizedSvg).toBe(
    normalizeTransientSvgIds(readFileSync(snapshotPath, "utf-8")),
  )
}

function normalizeTransientSvgIds(svg: string) {
  return svg
    .replaceAll(
      /silkscreen-knockout-mask-(pcb_silkscreen_text_\d+)-\d+/g,
      "silkscreen-knockout-mask-$1",
    )
    .replaceAll(/knockout-mask-(pcb_copper_text_\d+)-\d+/g, "knockout-mask-$1")
}

async function writePngArtifact({
  svg,
  testPath,
  artifactName,
}: {
  svg: string
  testPath: string
  artifactName: string
}) {
  const snapshotDir = path.join(path.dirname(testPath), "__snapshots__")
  const artifactPath = path.join(snapshotDir, `${artifactName}.snap.png`)
  const shouldUpdateSnapshot =
    process.argv.includes("--update-snapshots") ||
    process.argv.includes("-u") ||
    Boolean(process.env["BUN_UPDATE_SNAPSHOTS"])

  if (!existsSync(snapshotDir)) {
    mkdirSync(snapshotDir, { recursive: true })
  }

  if (!existsSync(artifactPath) || shouldUpdateSnapshot) {
    const png = await sharp(Buffer.from(svg))
      .resize({ height: 1280, withoutEnlargement: false })
      .png()
      .toBuffer()
    writeFileSync(artifactPath, png)
  }
}

function inferPcbSvgTransform({
  svg,
  pcbVias,
}: {
  svg: string
  pcbVias: Array<{ x: number; y: number }>
}) {
  const renderedViaCenters = [
    ...svg.matchAll(
      /<g data-type="pcb_via"[\s\S]*?<circle class="pcb-hole-outer"[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/g,
    ),
  ].map((match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }))

  if (renderedViaCenters.length < 2 || pcbVias.length < 2) {
    throw new Error("Expected at least two rendered pcb_via centers")
  }

  const renderedViaCenterKeys = new Set(
    renderedViaCenters.map((point) => getPointKey(point)),
  )
  const bestTransform = findMatchingViaSvgTransform({
    pcbVias,
    renderedViaCenters,
    renderedViaCenterKeys,
  })

  if (!bestTransform) {
    throw new Error("Unable to infer PCB SVG transform from rendered vias")
  }

  return bestTransform
}

function findMatchingViaSvgTransform({
  pcbVias,
  renderedViaCenters,
  renderedViaCenterKeys,
}: {
  pcbVias: Array<{ x: number; y: number }>
  renderedViaCenters: Array<{ x: number; y: number }>
  renderedViaCenterKeys: Set<string>
}) {
  for (let i = 0; i < pcbVias.length; i++) {
    for (let j = i + 1; j < pcbVias.length; j++) {
      const circuitA = pcbVias[i]!
      const circuitB = pcbVias[j]!

      if (
        Math.abs(circuitA.x - circuitB.x) <= 1e-9 &&
        Math.abs(circuitA.y - circuitB.y) <= 1e-9
      ) {
        continue
      }

      for (let a = 0; a < renderedViaCenters.length; a++) {
        for (let b = a + 1; b < renderedViaCenters.length; b++) {
          const screenA = renderedViaCenters[a]!
          const screenB = renderedViaCenters[b]!

          for (const [mappedScreenA, mappedScreenB] of [
            [screenA, screenB],
            [screenB, screenA],
          ] as const) {
            const transform = inferTransformFromPair({
              circuitA,
              circuitB,
              screenA: mappedScreenA,
              screenB: mappedScreenB,
            })

            if (
              transform &&
              pcbVias.every((via) =>
                renderedViaCenterKeys.has(
                  getPointKey(toScreen(via, transform)),
                ),
              )
            ) {
              return transform
            }
          }
        }
      }
    }
  }

  return undefined
}

function inferTransformFromPair({
  circuitA,
  circuitB,
  screenA,
  screenB,
}: {
  circuitA: { x: number; y: number }
  circuitB: { x: number; y: number }
  screenA: { x: number; y: number }
  screenB: { x: number; y: number }
}) {
  const circuitDX = circuitB.x - circuitA.x
  const circuitDY = circuitB.y - circuitA.y
  const screenDX = screenB.x - screenA.x
  const screenDY = screenA.y - screenB.y

  let scale: number | undefined

  if (Math.abs(circuitDX) > 1e-9) {
    scale = screenDX / circuitDX
    if (Math.abs(circuitDY) > 1e-9) {
      const scaleFromY = screenDY / circuitDY
      if (Math.abs(scaleFromY - scale) > 1e-6) {
        return undefined
      }
    }
  } else if (Math.abs(circuitDY) > 1e-9) {
    scale = screenDY / circuitDY
  }

  if (!scale || !Number.isFinite(scale) || scale <= 0) {
    return undefined
  }

  return {
    scale,
    translateX: screenA.x - scale * circuitA.x,
    translateY: screenA.y + scale * circuitA.y,
  }
}

function addViaOverlayToSvg({
  svg,
  transform,
  routeVias,
  unconnectedPcbVias,
  standalonePcbViasOnTraceRoute,
}: {
  svg: string
  transform: {
    scale: number
    translateX: number
    translateY: number
  }
  routeVias: Array<{ x: number; y: number }>
  unconnectedPcbVias: Array<{ x: number; y: number }>
  standalonePcbViasOnTraceRoute: Array<{ x: number; y: number }>
}) {
  const toScreen = (point: { x: number; y: number }) => ({
    x: transform.translateX + point.x * transform.scale,
    y: transform.translateY - point.y * transform.scale,
  })
  const markerRadius = Math.max(5, Math.abs(transform.scale) * 0.55)
  const strokeWidth = Math.max(2.5, Math.abs(transform.scale) * 0.12)
  const crosshair = markerRadius * 0.75

  const routeViaMarkers = routeVias
    .map((via) => {
      const point = toScreen(via)
      return `<circle cx="${point.x}" cy="${point.y}" r="${markerRadius * 0.62}" fill="none" stroke="#00ff66" stroke-width="${strokeWidth}" opacity="0.95" data-overlay-type="route-via"/>`
    })
    .join("")
  const unconnectedViaMarkers = unconnectedPcbVias
    .map((via) => {
      const point = toScreen(via)
      return [
        `<circle cx="${point.x}" cy="${point.y}" r="${markerRadius}" fill="rgba(255,0,0,0.18)" stroke="#ff1744" stroke-width="${strokeWidth}" opacity="0.98" data-overlay-type="standalone-pcb-via"/>`,
        `<path d="M ${point.x - crosshair} ${point.y} L ${point.x + crosshair} ${point.y} M ${point.x} ${point.y - crosshair} L ${point.x} ${point.y + crosshair}" stroke="#ff1744" stroke-width="${strokeWidth * 0.8}" stroke-linecap="round" data-overlay-type="standalone-pcb-via-crosshair"/>`,
      ].join("")
    })
    .join("")
  const standaloneOnTraceMarkers = standalonePcbViasOnTraceRoute
    .map((via) => {
      const point = toScreen(via)
      return [
        `<circle cx="${point.x}" cy="${point.y}" r="${markerRadius}" fill="rgba(255,176,0,0.16)" stroke="#ffb000" stroke-width="${strokeWidth}" opacity="0.98" data-overlay-type="standalone-pcb-via-on-trace-route"/>`,
        `<path d="M ${point.x - crosshair} ${point.y - crosshair} L ${point.x + crosshair} ${point.y + crosshair} M ${point.x + crosshair} ${point.y - crosshair} L ${point.x - crosshair} ${point.y + crosshair}" stroke="#ffb000" stroke-width="${strokeWidth * 0.8}" stroke-linecap="round" data-overlay-type="standalone-pcb-via-on-trace-route-x"/>`,
      ].join("")
    })
    .join("")

  const overlay = `<g id="via-route-overlay" data-route-via-count="${routeVias.length}" data-unconnected-standalone-pcb-via-count="${unconnectedPcbVias.length}" data-standalone-pcb-via-on-trace-route-count="${standalonePcbViasOnTraceRoute.length}">
    <rect x="12" y="12" width="390" height="80" rx="4" fill="rgba(0,0,0,0.72)" stroke="#ffffff" stroke-width="1"/>
    <text x="24" y="34" fill="#00ff66" font-family="Arial, sans-serif" font-size="14">green rings: vias embedded in pcb_trace.route (${routeVias.length})</text>
    <text x="24" y="56" fill="#ff5a76" font-family="Arial, sans-serif" font-size="14">red targets: standalone pcb_via not on any trace route point (${unconnectedPcbVias.length})</text>
    <text x="24" y="78" fill="#ffcf57" font-family="Arial, sans-serif" font-size="14">orange x: standalone pcb_via touching a trace point (${standalonePcbViasOnTraceRoute.length})</text>
    ${routeViaMarkers}
    ${unconnectedViaMarkers}
    ${standaloneOnTraceMarkers}
  </g>`

  return svg.replace("</svg>", `${overlay}</svg>`)
}

function toScreen(
  point: { x: number; y: number },
  transform: { scale: number; translateX: number; translateY: number },
) {
  return {
    x: transform.translateX + point.x * transform.scale,
    y: transform.translateY - point.y * transform.scale,
  }
}
