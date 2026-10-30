import { type GlobalLabel, type KicadSch, parseKicadSch } from "kicadts"

export interface ParsedProjectSchematic {
  schematic: KicadSch
  hierarchicalLabels: GlobalLabel[]
}

/** Locate direct children without interpreting strings, escapes, or comments. */
function getRootChildren(source: string) {
  const children: { start: number; end: number; token: string }[] = []
  let depth = 0
  let start = 0
  let quoted = false
  let comment = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (comment) {
      if (char === "\n") comment = false
      continue
    }
    if (quoted) {
      if (char === "\\") i++
      else if (char === '"') quoted = false
      continue
    }
    if (char === ";") comment = true
    else if (char === '"') quoted = true
    else if (char === "(") {
      if (depth === 1) start = i
      depth++
    } else if (char === ")") {
      depth--
      if (depth === 1) {
        const token = source.slice(start + 1, i).match(/^\s*([^\s()]+)/)?.[1]
        if (token) children.push({ start, end: i + 1, token })
      }
    }
  }
  return children
}

export function parseProjectSchematic(
  source: string,
  filePath: string,
): ParsedProjectSchematic {
  // kicadts supports global_label's fields but not hierarchical_label yet.
  // Adapt only root-level tokens, then separate them again before conversion;
  // a hierarchical label must never acquire global connectivity.
  const children = getRootChildren(source)
  const labelKinds = children
    .filter((child) =>
      ["global_label", "hierarchical_label"].includes(child.token),
    )
    .map((child) => child.token)
  let adapted = source
  for (const child of children.toReversed()) {
    if (child.token !== "hierarchical_label") continue
    adapted =
      adapted.slice(0, child.start) +
      adapted
        .slice(child.start, child.end)
        .replace(/^(\(\s*)hierarchical_label\b/, "$1global_label") +
      adapted.slice(child.end)
  }
  try {
    const schematic = parseKicadSch(adapted)
    const hierarchicalLabels = schematic.globalLabels.filter(
      (_, index) => labelKinds[index] === "hierarchical_label",
    )
    schematic.globalLabels = schematic.globalLabels.filter(
      (_, index) => labelKinds[index] !== "hierarchical_label",
    )
    return { schematic, hierarchicalLabels }
  } catch (error) {
    throw new Error(
      `Could not parse schematic "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
