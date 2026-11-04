import type { KicadSch, Sheet } from "kicadts"
import {
  type ParsedProjectSchematic,
  parseProjectSchematic,
} from "./parse-project-schematic"

export interface SchematicSheetInstance extends ParsedProjectSchematic {
  filePath: string
  instancePath: string
  parentPath?: string
  parentSheet?: Sheet
}

export interface SchematicProject {
  rootFilePath: string
  instances: SchematicSheetInstance[]
}

// Keep file-map resolution usable in browsers as well as Node/Bun.
export function normalizeProjectPath(path: string): string {
  const parts: string[] = []
  const normalized = path.replaceAll("\\", "/")
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop()
    else if (part !== ".." || !normalized.startsWith("/")) parts.push(part)
  }
  return `${normalized.startsWith("/") ? "/" : ""}${parts.join("/")}`
}

function resolveChildPath(parent: string, child: string): string {
  const normalized = child.replaceAll("\\", "/")
  return normalizeProjectPath(
    normalized.startsWith("/")
      ? normalized
      : `${parent.slice(0, parent.lastIndexOf("/") + 1)}${normalized}`,
  )
}

function getSheetFile(sheet: Sheet): string {
  return (
    sheet.properties.find((property) => property.key === "Sheetfile")?.value ??
    ""
  )
}

export function loadSchematicProject(
  files: Record<string, string>,
  explicitRoot?: string,
): SchematicProject | undefined {
  const paths = Object.keys(files)
    .filter((path) => path.toLowerCase().endsWith(".kicad_sch"))
    .sort()
  if (!paths.length && !explicitRoot) return undefined
  const parsed = new Map<string, ParsedProjectSchematic>()
  const getParsed = (path: string) => {
    let result = parsed.get(path)
    if (!result) {
      const source = files[path]
      if (source === undefined) {
        throw new Error(`Root schematic "${path}" was not supplied.`)
      }
      result = parseProjectSchematic(source, path)
      parsed.set(path, result)
    }
    return result
  }

  let rootFilePath = explicitRoot && normalizeProjectPath(explicitRoot)
  if (!rootFilePath) {
    const referenced = new Set(
      paths.flatMap((path) =>
        getParsed(path).schematic.sheets.map((sheet) =>
          resolveChildPath(path, getSheetFile(sheet)),
        ),
      ),
    )
    const candidates = paths.filter((path) => !referenced.has(path))
    if (candidates.length !== 1) {
      throw new Error(
        `Cannot determine the root schematic (${candidates.length} candidates${candidates.length ? `: ${candidates.join(", ")}` : "; the sheets may contain a cycle"}). Use setRootSchematic(path) to select a root.`,
      )
    }
    rootFilePath = candidates[0]!
  }

  const root = getParsed(rootFilePath)
  const projectName = rootFilePath
    .split("/")
    .at(-1)!
    .replace(/\.kicad_sch$/i, "")
  const instances: SchematicSheetInstance[] = []
  const missing: string[] = []
  const visit = (
    filePath: string,
    instancePath: string,
    ancestors: string[],
    parentPath?: string,
    parentSheet?: Sheet,
  ) => {
    if (ancestors.includes(filePath)) {
      throw new Error(
        `Cyclic schematic hierarchy: ${[...ancestors, filePath].join(" -> ")}`,
      )
    }
    const original = getParsed(filePath)
    instances.push({
      ...original,
      schematic: instantiateSchematic(
        original.schematic,
        instancePath,
        projectName,
      ),
      filePath,
      instancePath,
      parentPath,
      parentSheet,
    })
    for (const sheet of original.schematic.sheets) {
      const child = getSheetFile(sheet)
      if (!child) {
        missing.push(
          `sheet ${sheet.uuid?.value ?? "without UUID"} in "${filePath}" has no Sheetfile`,
        )
        continue
      }
      const childPath = resolveChildPath(filePath, child)
      if (files[childPath] === undefined) {
        missing.push(
          `"${filePath}" references "${child}" (expected "${childPath}")`,
        )
        continue
      }
      if (!sheet.uuid?.value) {
        throw new Error(
          `Sheet referencing "${child}" in "${filePath}" has no UUID.`,
        )
      }
      visit(
        childPath,
        `${instancePath}/${sheet.uuid.value}`,
        [...ancestors, filePath],
        instancePath,
        sheet,
      )
    }
  }
  visit(rootFilePath, `/${root.schematic.uuid?.value ?? "root"}`, [])
  if (missing.length) {
    throw new Error(
      `Incomplete schematic project. Supply all referenced .kicad_sch files:\n${missing.join("\n")}`,
    )
  }
  return { rootFilePath, instances }
}

function instantiateSchematic(
  original: KicadSch,
  instancePath: string,
  projectName: string,
): KicadSch {
  // Clone only the fields changed by instance annotations. Library geometry and
  // wires remain shared and read-only in the parse cache.
  const schematic: KicadSch = Object.assign(
    Object.create(Object.getPrototypeOf(original)),
    original,
  )
  schematic.symbols = original.symbols.map((symbol) => {
    const projects = symbol.instances?.projects ?? []
    const project =
      projects.find((entry) => entry.name === projectName) ??
      (projects.length === 1 ? projects[0] : undefined)
    const annotation = project?.paths.find(
      (entry) => entry.value === instancePath,
    )
    if (!annotation) return symbol
    const instance = Object.assign(
      Object.create(Object.getPrototypeOf(symbol)),
      symbol,
    )
    if (annotation.unit !== undefined) instance.unit = annotation.unit
    instance.properties = symbol.properties.map((property) =>
      property.key === "Reference" && annotation.reference
        ? Object.assign(
            Object.create(Object.getPrototypeOf(property)),
            property,
            { value: annotation.reference },
          )
        : property,
    )
    return instance
  })
  return schematic
}
