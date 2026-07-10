import { expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getSourcePortConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"

export function hasKicadCli() {
  try {
    execFileSync("kicad-cli", ["version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

export function hasWorkingKicadPcbDrc(kicadPcbPath: string) {
  try {
    exportKicadDrcJson(kicadPcbPath)
    return true
  } catch {
    return false
  }
}

export function expectCircuitJsonConnectivityMatchesKicadGencad(params: {
  circuitJson: any[]
  kicadPcbPath: string
}) {
  const { circuitJson, kicadPcbPath } = params
  const expectedGroups = getKicadGencadNetlistGroups(kicadPcbPath)
  const actualGroups = getCircuitJsonSourceConnectivityGroups(circuitJson)

  const missingFromCircuitJson = getMissingGroups(expectedGroups, actualGroups)
  const extraInCircuitJson = getMissingGroups(actualGroups, expectedGroups)

  expect({
    missingFromCircuitJson,
    extraInCircuitJson,
  }).toEqual({
    missingFromCircuitJson: [],
    extraInCircuitJson: [],
  })
}

export function expectCircuitJsonConnectivityMatchesKicadDrc(params: {
  circuitJson: any[]
  kicadPcbPath: string
}) {
  const { circuitJson, kicadPcbPath } = params
  const expectedGroups = getKicadGencadNetlistGroups(kicadPcbPath)
  const actualGroups = getCircuitJsonSourceConnectivityGroups(circuitJson)

  const missingFromCircuitJson = getMissingGroups(expectedGroups, actualGroups)
  const extraInCircuitJson = getMissingGroups(actualGroups, expectedGroups)

  const drcConnectivityMismatches = getKicadDrcConnectivityMismatches({
    kicadPcbPath,
    actualGroups,
  })

  expect({
    missingFromCircuitJson,
    extraInCircuitJson,
    drcConnectivityMismatches,
  }).toEqual({
    missingFromCircuitJson: [],
    extraInCircuitJson: [],
    drcConnectivityMismatches: [],
  })
}

export function getKicadGencadNetlistGroups(kicadPcbPath: string) {
  const gencadText = exportKicadGencad(kicadPcbPath)
  const groups: string[][] = []
  let inSignals = false
  let currentNodes = new Set<string>()

  const flushSignal = () => {
    if (currentNodes.size > 0) {
      groups.push([...currentNodes].sort(compareNodeKeys))
    }
    currentNodes = new Set()
  }

  for (const line of gencadText.split(/\r?\n/)) {
    if (line === "$SIGNALS") {
      inSignals = true
      continue
    }

    if (line === "$ENDSIGNALS") {
      flushSignal()
      inSignals = false
      continue
    }

    if (!inSignals) continue

    if (line.startsWith("SIGNAL ")) {
      flushSignal()
      continue
    }

    if (line.startsWith("NODE ")) {
      const [refdes, padNumber] = getQuotedFields(line)
      if (refdes && padNumber) {
        currentNodes.add(getNodeKey(refdes, padNumber))
      }
    }
  }

  return groups
}

function exportKicadGencad(kicadPcbPath: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "kicad-gencad-"))
  const inputPath = path.join(tempDir, path.basename(kicadPcbPath))
  const outputPath = path.join(
    tempDir,
    `${path.basename(kicadPcbPath, ".kicad_pcb")}.cad`,
  )
  copyFileSync(kicadPcbPath, inputPath)

  execFileSync(
    "kicad-cli",
    ["pcb", "export", "gencad", "-o", outputPath, inputPath],
    { stdio: "pipe" },
  )

  if (!existsSync(outputPath)) {
    throw new Error(`KiCad did not write Gencad netlist to ${outputPath}`)
  }

  return readFileSync(outputPath, "utf-8")
}

function exportKicadDrcJson(kicadPcbPath: string) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "kicad-drc-"))
  const inputPath = path.join(tempDir, path.basename(kicadPcbPath))
  const outputPath = path.join(
    tempDir,
    `${path.basename(kicadPcbPath, ".kicad_pcb")}.drc.json`,
  )
  copyFileSync(kicadPcbPath, inputPath)

  execFileSync(
    "kicad-cli",
    [
      "pcb",
      "drc",
      "--format",
      "json",
      "--severity-all",
      "--all-track-errors",
      "--refill-zones",
      "-o",
      outputPath,
      inputPath,
    ],
    { stdio: "pipe" },
  )

  if (!existsSync(outputPath)) {
    throw new Error(`KiCad did not write DRC JSON to ${outputPath}`)
  }

  return JSON.parse(readFileSync(outputPath, "utf-8"))
}

function getKicadDrcConnectivityMismatches(params: {
  kicadPcbPath: string
  actualGroups: string[][]
}) {
  const { kicadPcbPath, actualGroups } = params
  const drcJson = exportKicadDrcJson(kicadPcbPath)
  const connectivityIndex = getConnectivityIndex(actualGroups)
  return getKicadDrcViolations(drcJson)
    .map(normalizeKicadDrcViolation)
    .flatMap(getKicadDrcConnectivityAssertions)
    .filter(
      (assertion) =>
        !doesDrcConnectivityAssertionMatchCircuitJson(
          assertion,
          connectivityIndex,
        ),
    )
}

export function getCircuitJsonSourceConnectivityGroups(circuitJson: any[]) {
  const componentNameById = new Map<string, string>()
  for (const component of circuitJson) {
    if (component.type === "source_component") {
      componentNameById.set(component.source_component_id, component.name)
    }
  }

  const nodeKeyBySourcePortId = new Map<string, string>()
  for (const port of circuitJson) {
    if (port.type !== "source_port") continue

    const refdes = componentNameById.get(port.source_component_id)
    if (!refdes) continue

    nodeKeyBySourcePortId.set(
      port.source_port_id,
      getNodeKey(refdes, String(port.pin_number)),
    )
  }

  const connectivityMap = getSourcePortConnectivityMapFromCircuitJson(
    circuitJson as any,
  )
  const groups: string[][] = []

  for (const connectedIds of Object.values(connectivityMap.netMap)) {
    const nodeKeys = connectedIds
      .map((id) => nodeKeyBySourcePortId.get(id))
      .filter((nodeKey): nodeKey is string => Boolean(nodeKey))
    const group = [...new Set(nodeKeys)].sort(compareNodeKeys)
    if (group.length === 0) continue

    groups.push(group)
  }

  return groups.sort((a, b) =>
    getGroupSignature(a).localeCompare(getGroupSignature(b)),
  )
}

function getKicadDrcViolations(drcJson: any) {
  const violations: Array<{ sourceKey: string; value: any }> = []
  collectKicadDrcViolationArrays(drcJson, "", violations)
  return violations
}

function collectKicadDrcViolationArrays(
  value: any,
  keyPath: string,
  violations: Array<{ sourceKey: string; value: any }>,
) {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    const key = keyPath.split(".").pop() ?? keyPath
    if (isDrcViolationArrayKey(key)) {
      for (const item of value) {
        violations.push({ sourceKey: keyPath, value: item })
      }
    }
    return
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childPath = keyPath ? `${keyPath}.${key}` : key
    collectKicadDrcViolationArrays(childValue, childPath, violations)
  }
}

function isDrcViolationArrayKey(key: string) {
  return /violations?|errors?|warnings?|unconnected|short/i.test(key)
}

function normalizeKicadDrcViolation(violation: {
  sourceKey: string
  value: any
}) {
  const value = violation.value
  const rule = stringifyDrcField(
    value?.type ??
      value?.rule ??
      value?.code ??
      value?.error_code ??
      value?.errorCode ??
      value?.kind ??
      violation.sourceKey,
  )
  const severity = stringifyDrcField(value?.severity ?? value?.level ?? "")
  const description = stringifyDrcField(
    value?.description ??
      value?.message ??
      value?.error ??
      value?.title ??
      value?.text ??
      "",
  )
  const items = getKicadDrcViolationItems(value)

  return {
    rule,
    severity,
    description,
    items,
    searchText:
      `${violation.sourceKey} ${rule} ${severity} ${description} ${items.join(
        " ",
      )}`.toLowerCase(),
  }
}

function stringifyDrcField(value: any) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

function getKicadDrcViolationItems(value: any) {
  const items = value?.items ?? value?.objects ?? value?.locations ?? []
  const itemArray = Array.isArray(items) ? items : [items]
  return itemArray
    .map((item) => {
      if (!item) return ""
      if (typeof item === "string") return item
      return (
        item.description ??
        item.message ??
        item.ref ??
        item.reference ??
        item.uuid ??
        item.id ??
        JSON.stringify(item)
      )
    })
    .map((item) => String(item))
    .filter(Boolean)
}

function getKicadDrcConnectivityAssertions(
  violation: ReturnType<typeof normalizeKicadDrcViolation>,
) {
  const itemNodes = violation.items
    .map(getNodeKeyFromDrcItem)
    .filter((nodeKey): nodeKey is string => Boolean(nodeKey))

  if (itemNodes.length < 2) return []

  const nodes = [...new Set(itemNodes)].sort(compareNodeKeys)
  if (nodes.length < 2) return []

  const expectedRelation = getDrcExpectedRelation(violation)
  if (!expectedRelation) return []

  return [
    {
      rule: violation.rule,
      severity: violation.severity,
      description: violation.description,
      expectedRelation,
      nodes,
    },
  ]
}

function getDrcExpectedRelation(
  violation: ReturnType<typeof normalizeKicadDrcViolation>,
) {
  const rule = violation.rule.toLowerCase()

  if (rule === "shorting_items") {
    return "different-net"
  }

  if (rule === "unconnected_items") {
    return "same-net"
  }

  return null
}

function getNodeKeyFromDrcItem(item: string) {
  const match = item.match(
    /\b(?:PTH\s+|SMD\s+)?pad\s+(.+?)\s+\[[^\]]*\]\s+of\s+([^\s]+)/i,
  )
  if (!match) return null

  return getNodeKey(match[2]!, match[1]!)
}

export function getConnectivityIndex(groups: string[][]) {
  const groupSignaturesByNode = new Map<string, Set<string>>()
  for (const group of groups) {
    const signature = getGroupSignature(group)
    for (const nodeKey of group) {
      const signatures = groupSignaturesByNode.get(nodeKey) ?? new Set()
      signatures.add(signature)
      groupSignaturesByNode.set(nodeKey, signatures)
    }
  }

  return groupSignaturesByNode
}

export function doesDrcConnectivityAssertionMatchCircuitJson(
  assertion: {
    expectedRelation: string
    nodes: string[]
  },
  connectivityIndex: Map<string, Set<string>>,
) {
  const pairs = getUniqueNodePairs(assertion.nodes)
  if (pairs.length === 0) return true

  for (const [firstNode, secondNode] of pairs) {
    const firstGroups = connectivityIndex.get(firstNode) ?? new Set()
    const secondGroups = connectivityIndex.get(secondNode) ?? new Set()
    if (firstGroups.size === 0 || secondGroups.size === 0) return false

    const shareGroup = [...firstGroups].some((signature) =>
      secondGroups.has(signature),
    )

    if (assertion.expectedRelation === "same-net" && !shareGroup) {
      return false
    }

    if (assertion.expectedRelation === "different-net" && shareGroup) {
      return false
    }
  }

  return true
}

function getUniqueNodePairs(nodes: string[]) {
  const uniqueNodes = [...new Set(nodes)].sort(compareNodeKeys)
  const pairs: Array<[string, string]> = []

  for (let i = 0; i < uniqueNodes.length; i++) {
    for (let j = i + 1; j < uniqueNodes.length; j++) {
      pairs.push([uniqueNodes[i]!, uniqueNodes[j]!])
    }
  }

  return pairs
}

function getQuotedFields(line: string) {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    match[1]!.replace(/\\"/g, '"'),
  )
}

function getNodeKey(refdes: string, padNumber: string) {
  return `${refdes}.${padNumber}`
}

function getGroupSignature(group: string[]) {
  return [...new Set(group)].sort(compareNodeKeys).join("\n")
}

function getMissingGroups(
  expectedGroups: string[][],
  actualGroups: string[][],
) {
  const actualSignatureCounts = new Map<string, number>()
  for (const group of actualGroups) {
    const signature = getGroupSignature(group)
    actualSignatureCounts.set(
      signature,
      (actualSignatureCounts.get(signature) ?? 0) + 1,
    )
  }

  const missingGroups: string[][] = []
  for (const group of expectedGroups) {
    const signature = getGroupSignature(group)
    const count = actualSignatureCounts.get(signature) ?? 0
    if (count === 0) {
      missingGroups.push(group)
    } else {
      actualSignatureCounts.set(signature, count - 1)
    }
  }

  return missingGroups
}

function compareNodeKeys(a: string, b: string) {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  })
}
