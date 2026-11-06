import { $ } from "bun"
import { beforeAll, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { KicadToCircuitJsonConverter } from "../../../lib"
import { stackCircuitJsonKicadPngs } from "../../fixtures/stackCircuitJsonKicadPngs"
import { takeCircuitJsonSnapshot } from "../../fixtures/take-circuit-json-snapshot"
import { takeKicadSnapshot } from "../../fixtures/take-kicad-snapshot"
import "../../fixtures/png-matcher"

const kicadArduinoBoardsRoot = "node_modules/kicad-arduino-boards"
const kicadArduinoBoardsSparsePath = "KiCad Projects"
const dependencyProbePath = join(
  kicadArduinoBoardsRoot,
  "KiCad Projects/Arduino Leonardo/Arduino Leonardo.kicad_pcb",
)

export interface KicadArduinoBoardSnapshot {
  name: string
  path: string
  testFilePath: string
}

async function ensureKicadArduinoBoardsDependency() {
  if (existsSync(dependencyProbePath)) return

  await mkdir("node_modules", { recursive: true })

  if (!existsSync(kicadArduinoBoardsRoot)) {
    try {
      await $`git clone --depth 1 --filter=blob:none --sparse https://github.com/sabogalc/KiCad-Arduino-Boards.git ${kicadArduinoBoardsRoot}`
    } catch (error) {
      throw new Error(
        `Failed to install KiCad Arduino Boards into ${kicadArduinoBoardsRoot}: ${(error as any).stderr?.toString()}`,
      )
    }
  }

  if (existsSync(join(kicadArduinoBoardsRoot, ".git"))) {
    await $`git -C ${kicadArduinoBoardsRoot} sparse-checkout set ${kicadArduinoBoardsSparsePath}`
  }

  if (!existsSync(dependencyProbePath)) {
    throw new Error(
      `Missing KiCad Arduino Boards dependency file after install: ${dependencyProbePath}`,
    )
  }
}

export function testKicadArduinoBoardSnapshot(
  board: KicadArduinoBoardSnapshot,
) {
  beforeAll(async () => {
    await ensureKicadArduinoBoardsDependency()
  })

  test(`kicad-to-circuit-json: KiCad Arduino Boards ${board.name} PCB`, async () => {
    const kicadPcbPath = join(kicadArduinoBoardsRoot, board.path)

    if (!existsSync(kicadPcbPath)) {
      throw new Error(
        `Missing KiCad Arduino Boards dependency file: ${kicadPcbPath}`,
      )
    }

    const kicadPcbContent = readFileSync(kicadPcbPath, "utf-8")

    const converter = new KicadToCircuitJsonConverter()
    converter.addFile(basename(kicadPcbPath), kicadPcbContent)
    converter.runUntilFinished()

    const circuitJson = converter.getOutput()
    expect(circuitJson).toBeDefined()
    expect(circuitJson.length).toBeGreaterThan(0)

    const pcbBoards = (circuitJson as any[]).filter(
      (el) => el.type === "pcb_board",
    )
    const pcbComponents = (circuitJson as any[]).filter(
      (el) => el.type === "pcb_component",
    )
    const pcbTraces = (circuitJson as any[]).filter(
      (el) => el.type === "pcb_trace",
    )

    expect(pcbBoards).toHaveLength(1)
    expect(pcbComponents.length).toBeGreaterThan(0)
    expect(pcbTraces.length).toBeGreaterThan(0)

    const snapshotDir = "tests/repros/kicad-arduino-boards/__snapshots__"
    await mkdir(snapshotDir, { recursive: true })
    await writeFile(
      join(snapshotDir, `${board.name}-circuit-json.json`),
      JSON.stringify(circuitJson, null, 2),
    )

    const kicadSnapshot = await takeKicadSnapshot({
      kicadFilePath: kicadPcbPath,
      kicadFileType: "pcb",
    })
    const kicadPng = Object.values(kicadSnapshot.generatedFileContent)[0]!

    const circuitJsonPng = await takeCircuitJsonSnapshot({
      circuitJson: circuitJson as any,
      outputType: "pcb",
    })

    const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
    const circuitJsonSvg = convertCircuitJsonToPcbSvg(circuitJson as any, {
      showCourtyards: true,
    })
    await writeFile(
      join(snapshotDir, `${board.name}-circuit-json.svg`),
      circuitJsonSvg,
    )

    const stackedPng = await stackCircuitJsonKicadPngs(circuitJsonPng, kicadPng)
    await expect(stackedPng).toMatchPngSnapshot(board.testFilePath, board.name)
  })
}
