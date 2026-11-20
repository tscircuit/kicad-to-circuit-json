import type { Footprint } from "kicadts"
import { getFootprintProperties } from "../stages/pcb/CollectFootprintsStage/footprint-properties"

export interface RotarySwitchDimensions {
  poles: number
  positions: number
}

export interface SourceSimpleRotarySwitchData {
  name: string
  ftype: "simple_rotary_switch"
  poles: number
  positions: number
  display_value?: string
  manufacturer_part_number?: string
  supplier_part_numbers?: Record<string, string[]>
}

const EXCLUDED_ROTARY_PATTERNS =
  /\bencoder\b|rotary[_-]?encoder|\bcoded\b|\bdip\b/i

const DIRECT_ROTARY_NXM_PATTERN =
  /(?:^|[:/_\s-])(?:sw_rotary|rotary_switch)[_-]?(\d+)x(\d+)(?:_mp)?(?:$|[:/_\s.-])/i

const ROTARY_SWITCH_INDICATOR_PATTERN =
  /(?:^|[:/_\s-])sw_rotary(?:$|[_-\s])|\brotary\s+(?:selector\s+|wafer\s+)?switch\b/i

const POLE_WORD_TO_COUNT: Record<string, number> = {
  single: 1,
  dual: 2,
  double: 2,
  triple: 3,
  quad: 4,
}

function parsePoleToken(token: string | undefined): number | undefined {
  if (!token) return undefined
  const lower = token.trim().toLowerCase()
  if (lower in POLE_WORD_TO_COUNT) {
    return POLE_WORD_TO_COUNT[lower]
  }
  const parsed = Number.parseInt(lower, 10)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined
}

export function inferRotarySwitchDimensions(params: {
  name?: string
  metadata?: string
  pinIdentifiers?: Array<string | number | undefined | null>
}): RotarySwitchDimensions | null {
  const combined = [params.name, params.metadata]
    .filter(Boolean)
    .join(" ")
    .trim()
  if (!combined || !/rotary/i.test(combined)) return null

  if (EXCLUDED_ROTARY_PATTERNS.test(combined)) {
    return null
  }

  const directMatch = DIRECT_ROTARY_NXM_PATTERN.exec(combined)
  if (directMatch) {
    const poles = Number.parseInt(directMatch[1]!, 10)
    const positions = Number.parseInt(directMatch[2]!, 10)
    if (poles >= 1 && positions >= 2) {
      return { poles, positions }
    }
  }

  if (!ROTARY_SWITCH_INDICATOR_PATTERN.test(combined)) {
    return null
  }

  const nxmMatch = /\b(\d+)\s*x\s*(\d+)\b/i.exec(combined)
  if (nxmMatch) {
    const poles = Number.parseInt(nxmMatch[1]!, 10)
    const positions = Number.parseInt(nxmMatch[2]!, 10)
    if (poles >= 1 && positions >= 2) {
      return { poles, positions }
    }
  }

  const nPnTMatch = /\b(\d+)p(\d+)t\b/i.exec(combined)
  if (nPnTMatch) {
    const poles = Number.parseInt(nPnTMatch[1]!, 10)
    const positions = Number.parseInt(nPnTMatch[2]!, 10)
    if (poles >= 1 && positions >= 2) {
      return { poles, positions }
    }
  }

  const descriptiveMatch =
    /\b(single|dual|double|triple|quad|\d+)[-\s]*poles?(?:[\s,/-]+|\s+x\s+)(\d+)[-\s]*(?:positions?|pos|throws?|ways?)\b/i.exec(
      combined,
    )
  if (descriptiveMatch) {
    const poles = parsePoleToken(descriptiveMatch[1])
    const positions = Number.parseInt(descriptiveMatch[2]!, 10)
    if (poles && poles >= 1 && positions >= 2) {
      return { poles, positions }
    }
  }

  if (params.pinIdentifiers && params.pinIdentifiers.length > 0) {
    const poleOnlyMatch =
      /\b(single|dual|double|triple|quad|\d+)[-\s]*poles?\b/i.exec(combined)
    const poles = parsePoleToken(poleOnlyMatch?.[1]) ?? 1
    const numericPins = new Set<number>()

    for (const rawId of params.pinIdentifiers) {
      const normalized = `${rawId ?? ""}`.trim()
      if (!/^\d+$/.test(normalized)) continue
      const num = Number.parseInt(normalized, 10)
      if (num >= 1) {
        numericPins.add(num)
      }
    }

    if (numericPins.size >= poles * 3 && numericPins.size % poles === 0) {
      const positions = numericPins.size / poles - 1
      if (positions >= 2) {
        return { poles, positions }
      }
    }
  }

  return null
}

export function inferRotarySwitchFromFootprint(
  footprint: Footprint | undefined,
): RotarySwitchDimensions | null {
  if (!footprint) return null

  const textFpValues = (
    Array.isArray(footprint.fpTexts)
      ? footprint.fpTexts
      : footprint.fpTexts
        ? [footprint.fpTexts]
        : []
  ).map((item) => item?.text)

  const metadata = [
    footprint.descr?.value,
    footprint.tags?.value,
    ...getFootprintProperties(footprint).map((prop) => prop.value),
    ...textFpValues,
  ]
    .filter(Boolean)
    .join(" ")

  if (!/rotary/i.test(`${footprint.libraryLink ?? ""} ${metadata}`)) {
    return null
  }

  const padNumbers = (footprint.fpPads || []).map((pad) => pad.number)

  return inferRotarySwitchDimensions({
    name: footprint.libraryLink,
    metadata,
    pinIdentifiers: padNumbers,
  })
}
