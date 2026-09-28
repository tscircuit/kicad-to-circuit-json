import { expect, test } from "bun:test"
import "bun-match-svg"
import { $ } from "bun"
import { readFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { parseKicadPcb } from "kicadts"
import { KicadToCircuitJsonConverter } from "../../../lib"

const contents = (svg: string) =>
  svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "")

test("repro4948: OCuLink board loses all 3 filled fabrication polarity marks", async () => {
  const filename = "tests/assets/oculink-to-pcie-adapter.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("oculink-to-pcie-adapter.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const names = Object.fromEntries(
    circuitJson
      .filter((e) => e.type === "source_component")
      .map((e) => [e.source_component_id, e.name]),
  )
  const components = circuitJson.filter((e) => e.type === "pcb_component")
  const rectangles = circuitJson.filter(
    (e) => e.type === "pcb_fabrication_note_rect",
  )
  const marks = source.footprints.flatMap((footprint) => {
    const reference = footprint.properties.find(
      (p) => p.key === "Reference",
    )?.value
    const component = components.find(
      (c) => names[c.source_component_id] === reference,
    )
    const sourceRects = footprint.fpRects.filter((r) =>
      r.layer?.names.includes("F.Fab"),
    )
    if (!sourceRects.length) return []
    if (!component) throw new Error(`Missing footprint ${reference}`)
    const imported = rectangles.filter(
      (r) => r.pcb_component_id === component.pcb_component_id,
    )
    expect(imported).toHaveLength(sourceRects.length)
    return sourceRects.flatMap((rect, index) => {
      const actual = imported[index]!
      expect(actual.is_filled).toBe(false)
      if (!rect.fill) return []
      if (!rect.start || !rect.end) throw new Error("Missing mark endpoints")
      expect(actual).toMatchObject({
        width: 0.25,
        height: 1.75,
        layer: "top",
        has_stroke: true,
      })
      expect(rect.end.x - rect.start.x).toBeCloseTo(actual.width, 6)
      expect(Math.abs(rect.end.y - rect.start.y)).toBeCloseTo(actual.height, 6)
      return [{ reference, footprint, component, actual }]
    })
  })
  expect(marks.map((m) => m.reference).sort()).toEqual(["D7", "D8", "D9"])
  const preserved = marks.filter((m) => m.actual.is_filled).length
  expect(preserved).toBe(0)
  const sample = marks.find((m) => m.reference === "D9")!
  const board = circuitJson.find((e) => e.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const width = board.width + 6
  const height = board.height + 6
  const centerX = sample.footprint.position!.x - sample.component.center.x
  const centerY = sample.footprint.position!.y + sample.component.center.y
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter((e) => !e.type.startsWith("pcb_silkscreen")),
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
  const dir = await mkdtemp(join(tmpdir(), "fab-fill-"))
  try {
    const output = join(dir, "source.svg")
    await $`kicad-cli pcb export svg ${filename} -o ${output} --layers F.Cu,B.Cu,F.Fab,B.Fab,Edge.Cuts --mode-single --page-size-mode 1 --exclude-drawing-sheet`.quiet()
    const sourceSvg = await readFile(output, "utf8")
    const panel = (
      id: string,
      x: number,
      y: number,
      h: number,
      viewBox: string,
    ) =>
      `<rect x="${x}" y="${y}" width="684" height="${h}" fill="black" stroke="#425563"/><svg x="${x}" y="${y}" width="684" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><use href="#${id}"/></svg>`
    const cx = sample.actual.center.x
    const cy = sample.actual.center.y
    const color = preserved === marks.length ? "#8fd6a7" : "#ff8585"
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="940" viewBox="0 0 1440 940">
<rect width="100%" height="100%" fill="#101820"/>
<defs><g id="source">${contents(sourceSvg)}</g><g id="imported">${contents(importedSvg)}</g></defs>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">OCuLink to PCIe Adapter — filled fabrication polarity marks</text>
<text x="24" y="78" font-size="21">Original KiCad · full board</text>
<text x="732" y="78" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="108" font-size="18" fill="#8fd6a7">3 filled marks · D7, D8, D9</text>
<text x="732" y="108" font-size="18" fill="${color}">${preserved} fills preserved · ${marks.length - preserved} lost</text>
<text x="24" y="490" font-size="21">D9 polarity mark · original · filled</text>
<text x="732" y="490" font-size="21">D9 polarity mark · imported · ${sample.actual.is_filled ? "filled" : "outline only"}</text>
<text x="24" y="522" font-size="18">0.25 × 1.75 mm</text>
<text x="732" y="522" font-size="18">Same position, dimensions and stroke; fill is ${sample.actual.is_filled ? "preserved" : "missing"}</text>
<text x="24" y="918" font-size="17">Both close-ups show the same 6 × 3 mm area centered on the vertical polarity mark.</text>
</g>
${panel("source", 24, 128, 320, `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`)}
${panel("imported", 732, 128, 320, `0 0 ${width} ${height}`)}
${panel("source", 24, 542, 345, `${centerX + cx - 3} ${centerY - cy - 1.5} 6 3`)}
${panel("imported", 732, 542, 345, `${cx + width / 2 - 3} ${height / 2 - cy - 1.5} 6 3`)}
</svg>`
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30_000)
