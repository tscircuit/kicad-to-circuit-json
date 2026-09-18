import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"

const sourceDirectory = resolve(import.meta.dir, "..")
if (!sourceDirectory.split(sep).includes("node_modules")) process.exit(0)

// Build outside node_modules so tsup bundles the local type declarations.
const buildDirectory = await mkdtemp(join(tmpdir(), "kicad-importer-prepare-"))
try {
  for (const file of ["lib", "package.json", "tsconfig.json"]) {
    await cp(join(sourceDirectory, file), join(buildDirectory, file), {
      recursive: true,
    })
  }
  for (const command of [
    ["bun", "install", "--ignore-scripts"],
    ["bun", "run", "build"],
  ]) {
    const result = Bun.spawn(command, {
      cwd: buildDirectory,
      stdout: "inherit",
      stderr: "inherit",
    })
    if ((await result.exited) !== 0) {
      throw new Error(`Importer dependency build failed: ${command.join(" ")}`)
    }
  }
  await cp(join(buildDirectory, "dist"), join(sourceDirectory, "dist"), {
    recursive: true,
  })
} finally {
  await rm(buildDirectory, { recursive: true, force: true })
}
