import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { pcb_component } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"

const contents = (svg: string) =>
  svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")
const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

test("repro4948: HDMI EDID board preserves 98 3D model records and reports 3 additional models", async () => {
  const filename = "tests/assets/hdmi-edid-debug-board.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("hdmi-edid-debug-board.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const names = Object.fromEntries(
    circuitJson
      .filter((e) => e.type === "source_component")
      .map((e) => [e.source_component_id, e.name]),
  )
  const components = circuitJson.filter((e) => e.type === "pcb_component")
  const parts = source.footprints.map((footprint) => {
    const reference = footprint.properties.find(
      (p) => p.key === "Reference",
    )?.value
    const component = components.find(
      (c) => names[c.source_component_id] === reference,
    )
    if (!component) throw new Error(`Missing ${reference}`)
    const model = footprint.models[0]
    const imported = component.metadata?.kicad_footprint?.model
    expect(imported).toEqual(
      model
        ? {
            path: model.path,
            offset: model.offset,
            scale: model.scale,
            rotate: model.rotate,
          }
        : undefined,
    )
    expect(
      pcb_component.parse(component).metadata?.kicad_footprint?.model,
    ).toEqual(imported)
    return { footprint, reference, component, model, imported }
  })
  const sourceCount = source.footprints.reduce(
    (count, f) => count + f.models.length,
    0,
  )
  const preserved = parts.filter((p) => p.imported).length
  const warnings = converter.getWarnings().filter((w) => w.includes("3D model"))
  expect(sourceCount).toBe(101)
  expect(parts.filter((p) => p.model)).toHaveLength(98)
  expect(preserved).toBe(98)
  expect(warnings).toEqual(
    parts.flatMap((part) =>
      part.footprint.models
        .slice(1)
        .map(
          (model) =>
            `Footprint ${part.reference}: additional 3D model ${JSON.stringify(model.path)} was not imported; Circuit JSON footprint metadata supports one model per footprint.`,
        ),
    ),
  )
  expect(warnings).toHaveLength(3)
  const samples = ["R11", "J5", "J1"].map(
    (ref) => parts.find((p) => p.reference === ref)!,
  )
  expect(samples[1]!.model).toMatchObject({
    offset: { x: 0, y: -1.255, z: 0 },
    rotate: { x: -90, y: 0, z: 0 },
  })
  expect(samples[2]!.model).toMatchObject({
    offset: { x: -0.05, y: -2.925, z: 4.1 },
  })
  const board = circuitJson.find((e) => e.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const width = board.width + 8
  const height = board.height + 8
  const first = samples[0]!
  const centerX = first.footprint.position!.x - first.component.center.x
  const centerY = first.footprint.position!.y + first.component.center.y
  const native = await takeKicadSnapshot({
    kicadFileContent: content,
    kicadFileType: "pcb",
    generatePng: false,
    pcbSnapshotBounds: "circuit-json",
  })
  const nativeSvg = Object.values(native.generatedFileContent)[0]!.toString()
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter((e) => !e.type.startsWith("pcb_fabrication")),
    {
      width,
      height,
      viewport: {
        minX: -width / 2,
        maxX: width / 2,
        minY: -height / 2,
        maxY: height / 2,
      },
      showCourtyards: false,
      showPcbNotes: false,
      includeVersion: false,
    },
  )
  const rows = samples
    .map((p, i) => {
      const y = 762 + i * 65
      const offset = p.model!.offset!
      const rotation = p.model!.rotate!
      const name = p.model!.path.split("/").at(-1)!
      return `<text x="32" y="${y}">${p.reference} · ${escapeXml(name)}</text><text x="32" y="${y + 26}" font-size="16" fill="#b8c7d3">Offset (${offset.x}, ${offset.y}, ${offset.z}) mm · rotation (${rotation.x}, ${rotation.y}, ${rotation.z})°</text><text x="732" y="${y}" fill="${p.imported ? "#8fd6a7" : "#ff8585"}">${p.imported ? "Path, offset, scale and rotation preserved" : "Model reference and all transforms lost"}</text>`
    })
    .join("")
  const lost = sourceCount - preserved
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1040" viewBox="0 0 1440 1040">
<rect width="100%" height="100%" fill="#101820"/>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">HDMI EDID Debug Board — 3D model metadata</text>
<text x="24" y="78" font-size="21">Original KiCad · full 2D board</text><text x="732" y="78" font-size="21">Current Circuit JSON import · full 2D board</text>
<text x="24" y="110" font-size="18" fill="#8fd6a7">101 model references across 98 footprints</text><text x="732" y="110" font-size="18" fill="${preserved ? "#8fd6a7" : "#ff8585"}">${preserved} model records preserved · ${lost} omitted · ${warnings.length} warnings</text>
<text x="24" y="715" font-size="21">Original model data · footprint-local transforms</text><text x="732" y="715" font-size="21">Imported metadata</text>
<g font-size="19">${rows}</g>
<text x="24" y="982" font-size="18">J1, J4 and J5 each have a second model; the metadata schema supports one model per footprint.</text>
<text x="24" y="1014" font-size="17" fill="#b8c7d3">2D board geometry stays unchanged. Model paths/transforms are checked as metadata; this is not a 3D render.</text>
</g>
<rect x="24" y="140" width="684" height="540" fill="black" stroke="#425563"/><svg x="24" y="140" width="684" height="540" viewBox="${centerX - width / 2} ${centerY - height / 2} ${width} ${height}" preserveAspectRatio="xMidYMid meet">${contents(nativeSvg)}</svg>
<rect x="732" y="140" width="684" height="540" fill="black" stroke="#425563"/><svg x="732" y="140" width="684" height="540" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${contents(importedSvg)}</svg>
</svg>`
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 30_000)

test("reports hidden 3D model settings on the real Corne board", () => {
  const content = readFileSync(
    "tests/assets/corne-keyboard/corne-keyboard.kicad_pcb",
    "utf8",
  )
  const source = parseKicadPcb(content)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("corne-keyboard.kicad_pcb", content)
  converter.runUntilFinished()
  const hidden = source.footprints.flatMap((footprint) =>
    footprint.models
      .filter((model) => model.hide)
      .map((model) => ({
        model,
        reference: footprint.fpTexts.find((text) => text.type === "reference")!
          .text,
      })),
  )
  expect(hidden.map((p) => p.reference).sort()).toEqual(["J4", "rJ4"])
  const warnings = converter
    .getWarnings()
    .filter((message) => message.includes("unsupported visibility or opacity"))
  expect(warnings).toEqual(
    hidden.map(
      ({ reference, model }) =>
        `Footprint ${reference}: 3D model ${JSON.stringify(model.path)} has unsupported visibility or opacity settings; its path and transforms were imported without those settings.`,
    ),
  )
}, 30_000)
