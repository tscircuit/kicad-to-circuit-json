import type { KicadNetClass, KicadNetSettings } from "../../types"

const WILDCARD_SPECIAL_CHARACTERS = /[.+^${}()|[\]/\\]/g

// Regular expression syntax that PCRE2, the engine behind KiCad's patterns,
// reads differently from JavaScript.
const PCRE2_ONLY_SYNTAX = [
  /\\(?![dDwWsSbBtnrf])/, // a letter or digit escape other than these
  /\(\?(?![:=!])/, // a group other than (?: (?= (?!
  /\(\*/, // a verb such as (*UTF)
  /\[[:.=][^\]]*[:.=]\]/, // a POSIX class such as [:alpha:]
  /\[\^?\]/, // a character class that starts with "]"
  /[*+?}]\+/, // a possessive quantifier
  /\{,/, // {,n}
  /\[[^\]]*\\B/, // \B inside a character class
  /\[[^\]]*(?:\\[dDwWsS]-[^\]]|[^[\]^]-\\[dDwWsS])/, // [\d-x] or [a-\d]
  /[\ud800-\udfff]/, // a character outside the Basic Multilingual Plane
]

function getNetClassRegexSource(pattern: string): string {
  const regexStart = pattern.startsWith("^") ? "" : "^"
  const regexEnd = pattern.endsWith("$") ? "" : "$"
  return `${regexStart}${pattern}${regexEnd}`
}

/**
 * Returns false when the regular expression reading of a net class pattern
 * cannot be evaluated the way KiCad does. Its wildcard reading still applies.
 */
export function isNetClassRegexSupported(pattern: string): boolean {
  // Escaped punctuation is a literal in both engines, so only the rest is
  // inspected.
  const regexSyntax = getNetClassRegexSource(pattern).replace(
    /\\[^a-zA-Z0-9]/g,
    "_",
  )
  return !PCRE2_ONLY_SYNTAX.some((syntax) => syntax.test(regexSyntax))
}

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
  if (kicadNetName.search(new RegExp(`^${wildcard}$`, "su")) === 0) return true

  if (!isNetClassRegexSupported(pattern)) return false
  try {
    const regex = new RegExp(getNetClassRegexSource(pattern), "s")
    return kicadNetName.search(regex) === 0
  } catch {
    // Not a valid regular expression, so only the wildcard reading applies.
    return false
  }
}

function compareNetClassPrecedence(
  netClassA: KicadNetClass,
  netClassB: KicadNetClass,
): number {
  const priorityDifference =
    (netClassA.priority ?? 0) - (netClassB.priority ?? 0)
  if (priorityDifference !== 0) return priorityDifference
  return (netClassA.name ?? "") < (netClassB.name ?? "") ? -1 : 1
}

/**
 * Returns the net classes KiCad gives a net, highest precedence first and
 * ending with the Default class.
 *
 * - KiCad 6 lists the nets of a class inside the class.
 * - KiCad 7 and 8 give a net one class: its assignment, else its first
 *   matching pattern (NET_SETTINGS::GetEffectiveNetClass).
 * - KiCad 9+ gives a net every assigned class and every class with a matching
 *   pattern, ordered by priority and then by name
 *   (NET_SETTINGS::makeEffectiveNetclass).
 *
 * A class that is named but not defined adds nothing, as in KiCad.
 */
export function getKicadNetClasses({
  netSettings,
  kicadNetName,
}: {
  netSettings: KicadNetSettings
  kicadNetName: string
}): KicadNetClass[] {
  const netClasses = netSettings.classes ?? []
  const schemaVersion = netSettings.meta?.version ?? 0
  const assignment = netSettings.netclass_assignments?.[kicadNetName] ?? []
  const netClassNames = [assignment].flat()
  for (const { pattern, netclass } of netSettings.netclass_patterns ?? []) {
    if (pattern === undefined || netclass === undefined) continue
    if (!doesNetClassPatternMatch({ pattern, kicadNetName })) continue
    netClassNames.push(netclass)
  }
  // Before KiCad 9 only the first of them counts.
  if (schemaVersion < 4) netClassNames.splice(1)

  const namedNetClasses = netClasses.filter((netClass) => {
    if (!netClass.name || netClass.name === "Default") return false
    if (schemaVersion < 3 && netClass.nets?.includes(kicadNetName)) return true
    return netClassNames.includes(netClass.name)
  })
  const defaultNetClasses = netClasses.filter(
    (netClass) => netClass.name === "Default",
  )

  return [
    ...namedNetClasses.sort(compareNetClassPrecedence),
    ...defaultNetClasses,
  ]
}
