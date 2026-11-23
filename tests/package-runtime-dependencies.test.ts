import { expect, test } from "bun:test"
import fs from "node:fs"
import { builtinModules } from "node:module"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "..")

function getPackageName(specifier: string): string | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return null
  }
  const parts = specifier.split("/")
  const pkgName = specifier.startsWith("@")
    ? `${parts[0]}/${parts[1]}`
    : parts[0]!
  if (builtinModules.includes(pkgName)) {
    return null
  }
  return pkgName
}

function extractExternalPackages(source: string): string[] {
  const packages = new Set<string>()
  const pattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g
  for (const match of source.matchAll(pattern)) {
    const pkg = getPackageName(match[1]!)
    if (pkg) packages.add(pkg)
  }
  return [...packages].sort()
}

test("built package declares all external runtime and type dependencies and imports cleanly in an isolated consumer", () => {
  const buildResult = Bun.spawnSync([process.execPath, "run", "build:lib"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(buildResult.exitCode).toBe(0)

  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const declaredRuntimeDeps = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
  ])

  const distJs = fs.readFileSync(
    path.join(repoRoot, "dist", "index.js"),
    "utf8",
  )
  const distDts = fs.readFileSync(
    path.join(repoRoot, "dist", "index.d.ts"),
    "utf8",
  )

  const runtimeExternals = extractExternalPackages(distJs)
  const dtsExternals = extractExternalPackages(distDts)

  for (const dep of runtimeExternals) {
    expect(declaredRuntimeDeps.has(dep)).toBe(true)
  }
  for (const dep of dtsExternals) {
    expect(declaredRuntimeDeps.has(dep)).toBe(true)
  }

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "kicad-to-circuit-json-consumer-"),
  )
  try {
    const consumerNodeModules = path.join(tempDir, "node_modules")
    const installedSelfDir = path.join(
      consumerNodeModules,
      "kicad-to-circuit-json",
    )
    fs.mkdirSync(path.join(installedSelfDir, "dist"), { recursive: true })
    fs.copyFileSync(
      path.join(repoRoot, "package.json"),
      path.join(installedSelfDir, "package.json"),
    )
    for (const entry of fs.readdirSync(path.join(repoRoot, "dist"))) {
      fs.cpSync(
        path.join(repoRoot, "dist", entry),
        path.join(installedSelfDir, "dist", entry),
        { recursive: true },
      )
    }

    const symlinkType = process.platform === "win32" ? "junction" : "dir"
    for (const dep of Object.keys(pkgJson.dependencies ?? {})) {
      const srcDepDir = path.join(repoRoot, "node_modules", ...dep.split("/"))
      const destDepDir = path.join(consumerNodeModules, ...dep.split("/"))
      fs.mkdirSync(path.dirname(destDepDir), { recursive: true })
      fs.symlinkSync(srcDepDir, destDepDir, symlinkType)
    }

    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "repro-consumer", type: "module" }),
    )
    fs.writeFileSync(
      path.join(tempDir, "repro.mjs"),
      [
        'import { KicadToCircuitJsonConverter, KicadFootprintToCircuitJsonConverter, KicadSymbolToCircuitJsonConverter } from "kicad-to-circuit-json"',
        "console.log([typeof KicadToCircuitJsonConverter, typeof KicadFootprintToCircuitJsonConverter, typeof KicadSymbolToCircuitJsonConverter].join(','))",
      ].join("\n"),
    )

    const importResult = Bun.spawnSync([process.execPath, "repro.mjs"], {
      cwd: tempDir,
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(importResult.exitCode).toBe(0)
    expect(importResult.stdout.toString().trim()).toBe(
      "function,function,function",
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}, 60000)
