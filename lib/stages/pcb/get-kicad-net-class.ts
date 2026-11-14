import type { KicadProjectNetSettings } from "../../types"

const WILDCARD_SPECIAL_CHARACTERS = /[.+^${}()|[\]/\\]/g

/**
 * KiCad reads every net class pattern twice: as a regular expression and as a
 * `*` / `?` wildcard, each anchored to the whole net name. The pattern matches
 * when either reading matches from the start of the net name
 * (EDA_COMBINED_MATCHER with CTX_NETCLASS).
 */
function doesNetClassPatternMatch({
  pattern,
  kicadNetName,
}: {
  pattern: string
  kicadNetName: string
}): boolean {
  const wildcard = pattern
    .replace(WILDCARD_SPECIAL_CHARACTERS, "\\$&")
    .replace(/\?/g, ".")
    .replace(/\*/g, ".*")
  if (kicadNetName.search(new RegExp(`^${wildcard}$`)) === 0) return true

  const regexStart = pattern.startsWith("^") ? "" : "^"
  const regexEnd = pattern.endsWith("$") ? "" : "$"
  try {
    const regex = new RegExp(`${regexStart}${pattern}${regexEnd}`)
    return kicadNetName.search(regex) === 0
  } catch {
    // Not a valid regular expression, so only the wildcard reading applies.
    return false
  }
}

/**
 * Returns the net class KiCad gives a net: an explicit assignment, else the
 * first matching pattern, else the Default class
 * (NET_SETTINGS::GetEffectiveNetClass).
 */
export function getKicadNetClass({
  netSettings,
  kicadNetName,
}: {
  netSettings: KicadProjectNetSettings
  kicadNetName: string
}) {
  const netClasses = netSettings.classes ?? []
  const assignment = netSettings.netclass_assignments?.[kicadNetName]
  const assignedClassName = Array.isArray(assignment)
    ? assignment[0]
    : assignment
  const matchingPattern = netSettings.netclass_patterns?.find(
    ({ pattern }) =>
      pattern !== undefined &&
      doesNetClassPatternMatch({ pattern, kicadNetName }),
  )
  const netClassName = assignedClassName ?? matchingPattern?.netclass

  return (
    netClasses.find((netClass) => netClass.name === netClassName) ??
    netClasses.find((netClass) => netClass.name === "Default")
  )
}
