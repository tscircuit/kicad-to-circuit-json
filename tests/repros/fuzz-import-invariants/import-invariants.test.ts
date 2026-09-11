import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"
import { collectEvidence } from "./evidence"
import { renderEvidence } from "./render-evidence"

const dir = join(import.meta.dir, "__snapshots__")
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex")
const update = process.env.UPDATE_IMPORT_REPRO_SNAPSHOTS === "1"

test("KiCad import invariant characterization snapshots", async () => {
  const evidence = collectEvidence()
  expect(evidence).toHaveLength(5)
  if (update) mkdirSync(dir, { recursive: true })
  for (const entry of evidence) {
    const svg = renderEvidence(entry)
    const svgPath = join(dir, `${entry.name}.svg`)
    const pngPath = join(dir, `${entry.name}.png`)
    const dataPath = join(dir, `${entry.name}.json`)
    const integrityPath = join(dir, `${entry.name}.sha256.json`)
    const data = JSON.stringify(entry, null, 2) + "\n"
    if (update) {
      const png = await sharp(Buffer.from(svg)).png().toBuffer()
      writeFileSync(svgPath, svg)
      writeFileSync(pngPath, png)
      writeFileSync(dataPath, data)
      writeFileSync(
        integrityPath,
        JSON.stringify(
          { svg: hash(svg), png: hash(png), evidence: hash(data) },
          null,
          2,
        ) + "\n",
      )
    }
    expect(
      existsSync(svgPath),
      "Generate snapshots explicitly before committing",
    ).toBe(true)
    expect(readFileSync(svgPath, "utf8")).toBe(svg)
    expect(readFileSync(dataPath, "utf8")).toBe(data)
    const integrity = JSON.parse(readFileSync(integrityPath, "utf8"))
    expect(integrity.svg).toBe(hash(svg))
    expect(integrity.evidence).toBe(hash(data))
    const png = readFileSync(pngPath)
    expect(integrity.png).toBe(hash(png))
    const metadata = await sharp(png).metadata()
    expect([metadata.width, metadata.height]).toEqual([1000, 560])
  }
})
