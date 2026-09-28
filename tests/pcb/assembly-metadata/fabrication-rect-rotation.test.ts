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

for (const fixture of [
  {
    file: "Arduino Micro",
    name: "Arduino Micro",
    sample: "J3",
    count: 1,
    lost: 1,
  },
  {
    file: "dual-camera-to-gmsl-serializer-csi-adapter",
    name: "Dual Camera GMSL Adapter",
    sample: "C13",
    count: 57,
    lost: 12,
  },
]) {
  test(`repro4948: ${fixture.name} preserves fabrication rectangle rotation`, async () => {
    const filename = `tests/assets/${fixture.file}.kicad_pcb`
    const content = readFileSync(filename, "utf8")
    const source = parseKicadPcb(content)
    const converter = new KicadToCircuitJsonConverter()
    converter.addFile(`${fixture.file}.kicad_pcb`, content)
    converter.runUntilFinished()
    const circuitJson = converter.getOutput()
    const components = circuitJson.filter((e) => e.type === "pcb_component")
    const names = Object.fromEntries(
      circuitJson
        .filter((e) => e.type === "source_component")
        .map((e) => [e.source_component_id, e.name]),
    )
    const rectangles = circuitJson.filter(
      (e) => e.type === "pcb_fabrication_note_rect",
    )
    const rows = source.footprints.flatMap((footprint) => {
      const reference =
        footprint.properties.find((p) => p.key === "Reference")?.value ??
        footprint.fpTexts.find((t) => t.type === "reference")?.text
      const component = components.find(
        (c) => names[c.source_component_id] === reference,
      )
      const sourceRects = footprint.fpRects.filter((r) =>
        r.layer?.names.some((layer) => layer.endsWith(".Fab")),
      )
      if (!sourceRects.length) return []
      if (!component || !footprint.position)
        throw new Error(`Missing footprint ${reference}`)
      const imported = rectangles.filter(
        (r) => r.pcb_component_id === component.pcb_component_id,
      )
      expect(imported).toHaveLength(sourceRects.length)
      const angle =
        "angle" in footprint.position ? (footprint.position.angle ?? 0) : 0
      const radians = (angle * Math.PI) / 180
      return sourceRects.map((rect, index) => {
        const importedRect = imported[index]!
        if (!rect.start || !rect.end)
          throw new Error(`Missing rectangle endpoints for ${reference}`)
        const localCenter = {
          x: (rect.start.x + rect.end.x) / 2,
          y: (rect.start.y + rect.end.y) / 2,
        }
        const x =
          component.center.x +
          localCenter.x * Math.cos(radians) +
          localCenter.y * Math.sin(radians)
        const y =
          component.center.y +
          localCenter.x * Math.sin(radians) -
          localCenter.y * Math.cos(radians)
        const width = Math.abs(rect.end.x - rect.start.x)
        const height = Math.abs(rect.end.y - rect.start.y)
        // Independently project both local rectangle axes into board coordinates.
        const worldWidth =
          Math.abs(width * Math.cos(radians)) +
          Math.abs(height * Math.sin(radians))
        const worldHeight =
          Math.abs(width * Math.sin(radians)) +
          Math.abs(height * Math.cos(radians))
        expect(importedRect.center.x).toBeCloseTo(x, 6)
        expect(importedRect.center.y).toBeCloseTo(y, 6)
        expect(importedRect.layer).toBe(
          rect.layer?.names.includes("B.Fab") ? "bottom" : "top",
        )
        expect(importedRect.width).toBeCloseTo(worldWidth, 6)
        expect(importedRect.height).toBeCloseTo(worldHeight, 6)
        return {
          reference,
          component,
          footprint,
          rect,
          importedRect,
          worldWidth,
          worldHeight,
        }
      })
    })
    expect(rows).toHaveLength(fixture.count)
    const lost = rows.filter(
      (row) =>
        Math.abs(row.importedRect.width - row.worldWidth) > 1e-6 ||
        Math.abs(row.importedRect.height - row.worldHeight) > 1e-6,
    ).length
    expect(lost).toBe(0)
    const sample = rows.find((r) => r.reference === fixture.sample)!
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
    const dir = await mkdtemp(join(tmpdir(), "fab-rect-"))
    try {
      const output = join(dir, "source.svg")
      await $`kicad-cli pcb export svg ${filename} -o ${output} --layers F.Cu,B.Cu,F.Fab,B.Fab,Edge.Cuts --mode-single --page-size-mode 1 --exclude-drawing-sheet`.quiet()
      const originalSvg = await readFile(output, "utf8")
      const cropHeight = Math.max(sample.worldWidth, sample.worldHeight) + 2
      const cropWidth = cropHeight * 2
      const cx = sample.importedRect.center.x
      const cy = sample.importedRect.center.y
      const panel = (
        id: string,
        x: number,
        y: number,
        h: number,
        viewBox: string,
      ) =>
        `<rect x="${x}" y="${y}" width="684" height="${h}" fill="black" stroke="#425563"/><svg x="${x}" y="${y}" width="684" height="${h}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><use href="#${id}"/></svg>`
      const color = lost ? "#ff8585" : "#8fd6a7"
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="940" viewBox="0 0 1440 940">
<rect width="100%" height="100%" fill="#101820"/>
<defs><g id="source">${contents(originalSvg)}<rect x="${centerX + cx - sample.worldWidth / 2}" y="${centerY - cy - sample.worldHeight / 2}" width="${sample.worldWidth}" height="${sample.worldHeight}" fill="none" stroke="#43fcee" stroke-width="0.12"/></g><g id="imported">${contents(importedSvg)}<rect x="${cx + width / 2 - sample.importedRect.width / 2}" y="${height / 2 - cy - sample.importedRect.height / 2}" width="${sample.importedRect.width}" height="${sample.importedRect.height}" fill="none" stroke="#43fcee" stroke-width="0.12"/></g></defs>
<g font-family="sans-serif" fill="white">
<text x="24" y="38" font-size="26">${fixture.name} — fabrication rectangle rotation</text>
<text x="24" y="78" font-size="21">Original KiCad · full board including fabrication graphics</text>
<text x="732" y="78" font-size="21">Current Circuit JSON import · full board</text>
<text x="24" y="108" font-size="18" fill="#8fd6a7">${rows.length} fabrication rectangles</text>
<text x="732" y="108" font-size="18" fill="${color}">${rows.length - lost} correct · ${lost} wrongly oriented</text>
<text x="24" y="490" font-size="21">${fixture.sample} · ${sample.importedRect.layer} · original</text>
<text x="732" y="490" font-size="21">${fixture.sample} · imported</text>
<text x="24" y="522" font-size="18" fill="#8fd6a7">World bounds: ${sample.worldWidth.toFixed(2)} × ${sample.worldHeight.toFixed(2)} mm</text>
<text x="732" y="522" font-size="18" fill="${color}">World bounds: ${sample.importedRect.width.toFixed(2)} × ${sample.importedRect.height.toFixed(2)} mm</text>
<text x="24" y="918" font-size="17">Identical board coordinates in both close-ups. Cyan highlights the inspected rectangle; centers are unchanged.</text>
</g>
${panel("source", 24, 128, 320, `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`)}
${panel("imported", 732, 128, 320, `0 0 ${width} ${height}`)}
${panel("source", 24, 542, 345, `${centerX + cx - cropWidth / 2} ${centerY - cy - cropHeight / 2} ${cropWidth} ${cropHeight}`)}
${panel("imported", 732, 542, 345, `${cx + width / 2 - cropWidth / 2} ${height / 2 - cy - cropHeight / 2} ${cropWidth} ${cropHeight}`)}
</svg>`
      await expect(svg).toMatchSvgSnapshot(import.meta.path, fixture.file)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
}
