import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { takeKicadSnapshot } from "./take-kicad-snapshot"
import "./png-matcher"

test("takeKicadSnapshot - schematic export", async () => {
  console.log("Testing KiCad schematic snapshot...")

  const kicadSchPath = join(
    import.meta.dir,
    "../../kicad-demos/demos/flat_hierarchy/flat_hierarchy.kicad_sch",
  )

  if (!existsSync(kicadSchPath)) {
    console.warn(
      `Skipping schematic snapshot test, fixture missing: ${kicadSchPath}`,
    )
    return
  }

  const snapshot = await takeKicadSnapshot({
    kicadFilePath: kicadSchPath,
    kicadFileType: "sch",
  })

  // Basic assertions
  expect(snapshot).toBeDefined()
  expect(snapshot.exitCode).toBe(0)
  expect(snapshot.generatedFileContent).toBeDefined()

  // Check that at least one PNG was generated
  const pngFiles = Object.keys(snapshot.generatedFileContent)
  console.log(`Generated ${pngFiles.length} PNG file(s):`, pngFiles)
  expect(pngFiles.length).toBeGreaterThan(0)

  // Test each generated PNG file
  for (const [filename, pngBuffer] of Object.entries(
    snapshot.generatedFileContent,
  )) {
    console.log(`Checking ${filename} (${pngBuffer.length} bytes)`)

    // Verify it's a valid PNG buffer
    expect(pngBuffer).toBeInstanceOf(Buffer)
    expect(pngBuffer.length).toBeGreaterThan(0)

    // Check PNG magic number
    expect(pngBuffer.toString("hex", 0, 8)).toBe("89504e470d0a1a0a")

    // Create snapshot with filename
    const snapshotName = filename.replace(/\//g, "-").replace(".png", "")
    await expect(pngBuffer).toMatchPngSnapshot(import.meta.path, snapshotName)
  }

  console.log("✓ All snapshots match!")
})
