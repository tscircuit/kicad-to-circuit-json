import { expect, test } from "bun:test"
import "bun-match-svg"
import { readFileSync } from "node:fs"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { applyToPoint, inverse } from "transformation-matrix"
import { KicadToCircuitJsonConverter } from "../../lib"
import { takeKicadSnapshot } from "../fixtures/take-kicad-snapshot"

const boards = [
  {
    name: "GMSL Serializer",
    filename: "gmsl-serializer",
    reference: "Y1",
    padNumber: "1",
    angle: 45,
    corner: "bottom_left",
    width: 1.3,
    height: 1.1,
    center: { x: 154.57852, y: 103.303569 },
    // Native KiCad PAD.TransformShapeToPolygon, zero clearance, 0.001 mm error.
    nativePolygon: [
      { x: 153.729992, y: 103.37428 },
      { x: 154.649231, y: 102.455041 },
      { x: 155.427048, y: 103.232858 },
      { x: 154.663373, y: 103.996534 },
      { x: 154.352246, y: 103.996534 },
    ],
  },
  {
    name: "OCuLink to PCIe Adapter",
    filename: "oculink-to-pcie-adapter",
    reference: "U7",
    padNumber: "15",
    angle: 90,
    corner: "top_right",
    width: 2.1,
    height: 1.4,
    center: { x: 140.303, y: 63 },
    nativePolygon: [
      { x: 139.603, y: 64.05 },
      { x: 139.603, y: 62.23 },
      { x: 139.883, y: 61.95 },
      { x: 141.003, y: 61.95 },
      { x: 141.003, y: 64.05 },
    ],
  },
]

test.each(boards)(
  "repro4948: $name preserves chamfered pad copper and identity on import",
  async (fixture) => {
    const content = readFileSync(
      `tests/assets/${fixture.filename}.kicad_pcb`,
      "utf8",
    )
    const source = parseKicadPcb(content)
    const sourceFootprint = source.footprints.find((footprint) =>
      footprint.properties.some(
        (property) =>
          property.key === "Reference" && property.value === fixture.reference,
      ),
    )!
    const sourcePad = sourceFootprint.fpPads.find(
      (pad) => pad.number === fixture.padNumber,
    )!
    expect(sourcePad.chamferRatio).toBe(0.2)
    expect(sourcePad.chamferCorners).toEqual([fixture.corner])
    expect(sourcePad.roundrectRatio).toBe(0)
    expect(sourcePad.at?.angle).toBe(fixture.angle)
    expect(sourcePad.size?.width).toBe(fixture.width)
    expect(sourcePad.size?.height).toBe(fixture.height)

    const converter = new KicadToCircuitJsonConverter()
    converter.addFile(`${fixture.filename}.kicad_pcb`, content)
    converter.runUntilFinished()
    const circuitJson = converter.getOutput()
    const board = circuitJson.find((item) => item.type === "pcb_board")
    if (!board?.width || !board.height) throw new Error("Missing board bounds")
    const componentSource = circuitJson
      .filter((item) => item.type === "source_component")
      .find((item) => item.name === fixture.reference)!
    const component = circuitJson
      .filter((item) => item.type === "pcb_component")
      .find(
        (item) =>
          item.source_component_id === componentSource.source_component_id,
      )!
    const pads = circuitJson.filter(
      (item) =>
        item.type === "pcb_smtpad" &&
        item.pcb_component_id === component.pcb_component_id &&
        item.port_hints?.includes(fixture.padNumber),
    )
    expect(pads).toHaveLength(1)
    const pad = pads[0]!
    if (pad.type !== "pcb_smtpad") throw new Error("Missing SMT pad")
    const port = circuitJson.find(
      (item) =>
        item.type === "pcb_port" && item.pcb_port_id === pad.pcb_port_id,
    )!
    if (port.type !== "pcb_port") throw new Error("Missing PCB port")
    const expectedCenter = applyToPoint(
      converter.ctx!.k2cMatPcb!,
      fixture.center,
    )
    expect(port.x).toBeCloseTo(expectedCenter.x, 5)
    expect(port.y).toBeCloseTo(expectedCenter.y, 5)
    expect(pad.layer).toBe("top")
    expect(pad.shape).toBe("polygon")
    if (pad.shape !== "polygon") throw new Error("Missing chamfered polygon")
    expect(pad.points).toHaveLength(fixture.nativePolygon.length)
    for (const nativePoint of fixture.nativePolygon) {
      const expected = applyToPoint(converter.ctx!.k2cMatPcb!, nativePoint)
      expect(
        pad.points.some(
          (point) =>
            Math.hypot(point.x - expected.x, point.y - expected.y) < 0.00001,
        ),
      ).toBe(true)
    }

    const sourceArea =
      fixture.width * fixture.height -
      (Math.min(fixture.width, fixture.height) * 0.2) ** 2 / 2
    const importedArea =
      Math.abs(
        pad.points.reduce((sum, point, index) => {
          const next = pad.points[(index + 1) % pad.points.length]!
          return sum + point.x * next.y - next.x * point.y
        }, 0),
      ) / 2
    expect(importedArea).toBeCloseTo(sourceArea, 8)
    const chamferPreserved = Math.abs(importedArea - sourceArea) < 0.00001

    const center = applyToPoint(
      inverse(converter.ctx!.k2cMatPcb!),
      board.center,
    )
    const width = board.width + 4
    const height = board.height + 4
    const original = await takeKicadSnapshot({
      kicadFileContent: content,
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
        viewport: {
          minX: -width / 2,
          maxX: width / 2,
          minY: -height / 2,
          maxY: height / 2,
        },
        showCourtyards: false,
        showPcbNotes: false,
        includeVersion: false,
        colorOverrides: { drill: "#e2e8f0", substrate: "#263440" },
      },
    )
    const contents = (svg: string) =>
      svg
        .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
        .replace(/<\/svg>\s*$/, "")
        .replace(/<title>[\s\S]*?<\/title>/, "")
    const panel = (
      id: string,
      x: number,
      y: number,
      h: number,
      viewBox: string,
    ) =>
      `<rect x="${x}" y="${y}" width="684" height="${h}" fill="black" stroke="#425563"/><svg x="${x}" y="${y}" width="684" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><use xlink:href="#${id}"/></svg>`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1440" height="1360" viewBox="0 0 1440 1360">
<rect width="100%" height="100%" fill="#101820"/>
<defs><g id="source">${contents(originalSvg)}</g><g id="imported">${contents(importedSvg)}</g></defs>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">${fixture.name} — ${fixture.reference}.${fixture.padNumber} chamfered copper</text>
<text x="24" y="78" font-size="22">Original KiCad · full board</text>
<text x="732" y="78" font-size="22">Current Circuit JSON import · full board</text>
<text x="24" y="108" font-size="19" fill="#8fd6a7">1 chamfered pad · ${fixture.angle}° CCW</text>
<text x="732" y="108" font-size="19" fill="${chamferPreserved ? "#8fd6a7" : "#ff8585"}">${Number(chamferPreserved)} chamfers preserved · ${Number(!chamferPreserved)} lost</text>
<text x="24" y="877" font-size="21">${fixture.reference}.${fixture.padNumber} · ${fixture.corner} corner · original</text>
<text x="732" y="877" font-size="21">${fixture.reference}.${fixture.padNumber} · imported copper</text>
<text x="24" y="907" font-size="19" fill="#8fd6a7">Copper area ${sourceArea.toFixed(4)} mm²</text>
<text x="732" y="907" font-size="19" fill="${chamferPreserved ? "#8fd6a7" : "#ff8585"}">Copper area ${importedArea.toFixed(4)} mm²</text>
<text x="24" y="1345" font-size="17">Unmodified real board · pad identity, top layer and terminal position retained</text>
</g>
${panel("source", 24, 128, 700, `${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`)}
${panel("imported", 732, 128, 700, `0 0 ${width} ${height}`)}
${panel("source", 24, 928, 380, `${fixture.center.x - 2} ${fixture.center.y - 1.5} 4 3`)}
${panel("imported", 732, 928, 380, `${port.x + width / 2 - 2} ${height / 2 - port.y - 1.5} 4 3`)}
</svg>`
    await expect(svg).toMatchSvgSnapshot(import.meta.path, fixture.filename)
  },
  30_000,
)
