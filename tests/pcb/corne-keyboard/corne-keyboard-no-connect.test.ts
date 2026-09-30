import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const svgContents = (svg: string) =>
  svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")

test("repro4948: Corne Keyboard preserves all 6 explicit no-connect flags and pad nets", async () => {
  const filename = "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const sourcePads = source.footprints.flatMap((footprint) =>
    footprint.fpPads
      .filter((pad) => pad.pintype?.split("+").includes("no_connect"))
      .map((pad) => ({
        footprint,
        pad,
        reference: footprint.fpTexts.find((text) => text.type === "reference")!
          .text,
      })),
  )
  expect(
    sourcePads.map(({ reference, pad }) => `${reference}.${pad.number}`).sort(),
  ).toEqual(["EXLED2.2", "J1.A8", "J1.B8", "rEXLED2.2", "rJ1.A8", "rJ1.B8"])

  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const sourceComponents = circuitJson.filter(
    (item) => item.type === "source_component",
  )
  const pcbComponents = circuitJson.filter(
    (item) => item.type === "pcb_component",
  )
  const sourcePorts = circuitJson.filter((item) => item.type === "source_port")
  const pcbPorts = circuitJson.filter((item) => item.type === "pcb_port")
  const traces = circuitJson.filter((item) => item.type === "source_trace")
  const nets = circuitJson.filter((item) => item.type === "source_net")
  const imported = sourcePads.map(({ reference, footprint, pad }) => {
    const sourceComponent = sourceComponents.find(
      (item) => item.name === reference,
    )!
    const pcbComponent = pcbComponents.find(
      (item) =>
        item.source_component_id === sourceComponent.source_component_id,
    )!
    const port = sourcePorts.find(
      (item) =>
        item.source_component_id === sourceComponent.source_component_id &&
        item.name === (pad.number === "2" ? "pin2" : pad.number),
    )!
    expect(port).toBeDefined()
    expect(port.do_not_connect).toBe(true)
    const pcbPort = pcbPorts.find(
      (item) => item.source_port_id === port.source_port_id,
    )!
    const trace = traces.find((item) =>
      item.connected_source_port_ids.includes(port.source_port_id),
    )!
    const net = nets.find((item) =>
      trace.connected_source_net_ids?.includes(item.source_net_id),
    )!
    expect(net.name).toBe(
      `unconnected_${reference}_${pad.pinfunction}_Pad${pad.number}`,
    )
    const position = footprint.position!
    const radians =
      (("angle" in position ? (position.angle ?? 0) : 0) * Math.PI) / 180
    expect(pcbPort.x).toBeCloseTo(
      pcbComponent.center.x +
        pad.at!.x * Math.cos(radians) +
        pad.at!.y * Math.sin(radians),
      6,
    )
    expect(pcbPort.y).toBeCloseTo(
      pcbComponent.center.y +
        pad.at!.x * Math.sin(radians) -
        pad.at!.y * Math.cos(radians),
      6,
    )
    return { reference, pad, footprint, pcbComponent, port, pcbPort, net }
  })
  const markedPorts = sourcePorts.filter((port) => port.do_not_connect)
  expect(markedPorts).toHaveLength(sourcePads.length)
  const ncIds = new Set(imported.map(({ port }) => port.source_port_id))
  expect(
    sourcePorts.filter(
      (port) => !ncIds.has(port.source_port_id) && port.do_not_connect,
    ),
  ).toHaveLength(0)

  const board = circuitJson.find((item) => item.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const first = imported[0]!
  const centerX = first.footprint.position!.x - first.pcbComponent.center.x
  const centerY = first.footprint.position!.y + first.pcbComponent.center.y
  const width = board.width + 4
  const height = board.height + 4
  const minX = -width / 2
  const maxY = height / 2
  const original = await takeKicadSnapshot({
    kicadFilePath: filename,
    kicadFileType: "pcb",
    generatePng: false,
    pcbSnapshotBounds: "circuit-json",
  })
  const originalSvg = Object.values(
    original.generatedFileContent,
  )[0]!.toString()
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter((item) => !item.type.startsWith("pcb_fabrication")),
    {
      width,
      height,
      viewport: { minX, maxX: -minX, minY: -maxY, maxY },
      showCourtyards: false,
      showPcbNotes: false,
      includeVersion: false,
      colorOverrides: { drill: "#e2e8f0", substrate: "#263440" },
    },
  )
  const rows = imported
    .map(({ reference, pad, port, net }, index) => {
      const y = 575 + index * 40
      return `<text x="24" y="${y}">${reference} · pad ${pad.number}</text>
<text x="270" y="${y}">${pad.pintype}</text>
<text x="630" y="${y}">${net.name}</text>
<text x="1100" y="${y}" fill="${port.do_not_connect ? "#8fd6a7" : "#ff8585"}">${port.do_not_connect ? "NC preserved" : "NC flag lost"}</text>`
    })
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="850" viewBox="0 0 1440 850">
<rect width="1440" height="850" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">Corne Keyboard — explicit no-connect terminal intent</text>
<text x="24" y="80" font-size="21">Original KiCad · full board</text>
<text x="732" y="80" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">6 pads explicitly marked no_connect in KiCad pin types</text>
<text x="732" y="110" font-size="18" fill="${markedPorts.length ? "#8fd6a7" : "#ff8585"}">${markedPorts.length} NC flags preserved · ${sourcePads.length - markedPorts.length} lost · 6 nets retained</text>
<svg x="24" y="130" width="684" height="340" viewBox="${centerX + minX} ${centerY - maxY} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(originalSvg)}</svg>
<svg x="732" y="130" width="684" height="340" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${svgContents(importedSvg)}</svg>
<text x="24" y="515" font-size="21">Terminal identity</text><text x="270" y="515" font-size="21">Source pin type</text>
<text x="630" y="515" font-size="21">Imported net (unchanged)</text><text x="1100" y="515" font-size="21">Logical NC status</text>
<g font-size="18">${rows}</g>
<text x="24" y="827" font-size="17">NC is an explicit electrical constraint; it is not inferred from a missing net or from a net name. Copper geometry is unchanged.</text>
</g></svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)
