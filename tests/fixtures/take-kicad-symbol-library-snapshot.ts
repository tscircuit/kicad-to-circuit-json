import { $ } from "bun"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { colorMap } from "../../lib/color"

export interface KicadSymbolLibrarySnapshotOptions {
  kicadFilePath: string
  columns?: number
  tileWidth?: number
  tileHeight?: number
  theme?: string
}

export interface KicadSymbolLibrarySnapshot {
  png: Buffer
  symbolCount: number
  svgFileNames: string[]
}

export async function takeKicadSymbolLibrarySnapshot(
  params: KicadSymbolLibrarySnapshotOptions,
): Promise<KicadSymbolLibrarySnapshot> {
  const {
    kicadFilePath,
    columns = 6,
    tileWidth = 200,
    tileHeight = 190,
    theme = "Modern",
  } = params

  const kicadCliVersion = await $`kicad-cli --version`.quiet()
  if (!kicadCliVersion.stdout.toString().trim().startsWith("10.")) {
    throw new Error("kicad-cli version 10.0.0 or higher is required")
  }

  const tempDir = await mkdtemp(join(tmpdir(), "kicad-symbol-snapshot-"))

  try {
    await $`kicad-cli sym export svg ${kicadFilePath} -o ${tempDir} --theme ${theme}`.quiet()

    const svgFileNames = (await readdir(tempDir))
      .filter((fileName) => fileName.endsWith(".svg"))
      .sort()

    if (svgFileNames.length === 0) {
      throw new Error("No symbol SVG files were generated")
    }

    const symbolPngs = await Promise.all(
      svgFileNames.map(async (fileName) => {
        const svgBuffer = await readFile(join(tempDir, fileName))
        return sharp(svgBuffer, { density: 100 }).png().toBuffer()
      }),
    )

    return {
      png: await createSymbolContactSheet({
        symbolPngs,
        columns,
        tileWidth,
        tileHeight,
      }),
      symbolCount: svgFileNames.length,
      svgFileNames,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function createSymbolContactSheet(params: {
  symbolPngs: Buffer[]
  columns: number
  tileWidth: number
  tileHeight: number
}) {
  const { symbolPngs, columns, tileWidth, tileHeight } = params
  const rows = Math.ceil(symbolPngs.length / columns)
  const width = columns * tileWidth
  const height = rows * tileHeight

  const composites = await Promise.all(
    symbolPngs.map(async (png, index) => {
      const resized = await sharp(png)
        .resize(tileWidth - 24, tileHeight - 24, {
          fit: "contain",
          background:
            colorMap.snapshots.sharp.transparentKicadSchematicBackground,
        })
        .png()
        .toBuffer()
      const metadata = await sharp(resized).metadata()

      return {
        input: resized,
        left:
          (index % columns) * tileWidth +
          Math.floor((tileWidth - (metadata.width ?? tileWidth)) / 2),
        top:
          Math.floor(index / columns) * tileHeight +
          Math.floor((tileHeight - (metadata.height ?? tileHeight)) / 2),
      }
    }),
  )

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: colorMap.snapshots.sharp.kicadSchematicBackground,
    },
  })
    .composite(composites)
    .png()
    .toBuffer()
}
