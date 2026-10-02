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
  svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")

test("repro4948: GMSL serializer reports omitted fabrication circle fill", async () => {
  const filename = "tests/assets/gmsl-serializer.kicad_pcb"
  const content = readFileSync(filename, "utf8")
  const source = parseKicadPcb(content)
  const circles = source.footprints.flatMap((footprint) =>
    footprint.fpCircles
      .filter(
        (circle) =>
          circle.fill === true &&
          circle.layer?.names.some((layer) => layer.endsWith(".Fab")),
      )
      .map((circle) => ({ footprint, circle })),
  )
  expect(circles).toHaveLength(1)
  const { footprint, circle } = circles[0]!
  const reference = footprint.properties.find(
    (p) => p.key === "Reference",
  )!.value
  expect(reference).toBe("U6")
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile("gmsl-serializer.kicad_pcb", content)
  converter.runUntilFinished()
  const circuitJson = converter.getOutput()
  const sourceComponent = circuitJson.find(
    (e) => e.type === "source_component" && e.name === reference,
  )
  if (sourceComponent?.type !== "source_component")
    throw new Error("Missing U6")
  const component = circuitJson.find(
    (e) =>
      e.type === "pcb_component" &&
      e.source_component_id === sourceComponent.source_component_id,
  )
  if (
    component?.type !== "pcb_component" ||
    !footprint.position ||
    !circle.center ||
    !circle.end
  )
    throw new Error("Missing U6 geometry")
  const paths = circuitJson.filter(
    (e) =>
      e.type === "pcb_fabrication_note_path" &&
      e.pcb_component_id === component.pcb_component_id &&
      e.route.length === 17,
  )
  expect(paths).toHaveLength(1)
  const path = paths[0]!
  if (path.type !== "pcb_fabrication_note_path")
    throw new Error("Missing circle outline")
  const angle =
    "angle" in footprint.position ? (footprint.position.angle ?? 0) : 0
  const radians = (angle * Math.PI) / 180
  const cx =
    component.center.x +
    circle.center.x * Math.cos(radians) +
    circle.center.y * Math.sin(radians)
  const cy =
    component.center.y +
    circle.center.x * Math.sin(radians) -
    circle.center.y * Math.cos(radians)
  const radius = Math.hypot(
    circle.end.x - circle.center.x,
    circle.end.y - circle.center.y,
  )
  for (const point of path.route)
    expect(Math.hypot(point.x - cx, point.y - cy)).toBeCloseTo(radius, 6)
  expect(path.layer).toBe("top")
  const warnings = converter
    .getWarnings()
    .filter((message) => message.includes("filled fabrication circle"))
  expect(warnings).toEqual([
    `Footprint ${reference}: filled fabrication circle ${circle.uuid} on F.Fab was imported as an unfilled outline; solid fill is not preserved by this conversion.`,
  ])
  const board = circuitJson.find((e) => e.type === "pcb_board")
  if (!board?.width || !board.height) throw new Error("Missing board bounds")
  const width = board.width + 6
  const height = board.height + 6
  const centerX = footprint.position.x - component.center.x
  const centerY = footprint.position.y + component.center.y
  const importedSvg = convertCircuitJsonToPcbSvg(
    circuitJson.filter(
      (e) => !e.type.startsWith("pcb_silkscreen") && !e.type.endsWith("_text"),
    ),
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
  const dir = await mkdtemp(join(tmpdir(), "fab-circle-fill-"))
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1040" viewBox="0 0 1440 1040">
<rect width="100%" height="100%" fill="#101820"/>
<style>#source .stroked-text, #source text { display: none; }</style>
<defs><g id="source">${contents(sourceSvg)}</g><g id="imported">${contents(importedSvg)}</g></defs>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">GMSL Serializer — filled fabrication circle diagnostic</text>
<text x="24" y="78" font-size="21">Original KiCad · full board</text><text x="732" y="78" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="108" font-size="18" fill="#8fd6a7">U6: 1 filled fabrication circle</text><text x="732" y="108" font-size="18" fill="${warnings.length ? "#f9d56e" : "#ff8585"}">Fill omitted · ${warnings.length} warnings · ${1 - warnings.length} silent losses</text>
<text x="24" y="590" font-size="21">U6 original · solid fill · radius ${radius.toFixed(3)} mm</text><text x="732" y="590" font-size="21">U6 imported · outline only</text>
<text x="24" y="620" font-size="18">Same 4 × 2 mm area centered on the circle</text><text x="732" y="620" font-size="18" fill="${warnings.length ? "#f9d56e" : "#ff8585"}">${warnings.length ? "Loss reported with reference, layer and graphic ID" : "Fill disappears without a diagnostic"}</text>
<text x="24" y="1000" font-size="17">Text hidden. The wide stroke covers the center in both views; the omitted solid-fill flag still needs a diagnostic.</text>
</g>
${panel("source", 24, 128, 420, `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`)}
${panel("imported", 732, 128, 420, `0 0 ${width} ${height}`)}
${panel("source", 24, 640, 330, `${centerX + cx - 2} ${centerY - cy - 1} 4 2`)}
${panel("imported", 732, 640, 330, `${cx + width / 2 - 2} ${height / 2 - cy - 1} 4 2`)}
</svg>`
    await expect(svg).toMatchSvgSnapshot(import.meta.path)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}, 30_000)
