function isTokenBoundary(char: string | undefined) {
  return char === undefined || /\s|\(/.test(char)
}

function isFpPolyListAt(input: string, openParenIndex: number) {
  let index = openParenIndex + 1
  while (/\s/.test(input[index] ?? "")) index++

  const token = "fp_poly"
  if (input.slice(index, index + token.length) !== token) return false

  return isTokenBoundary(input[index + token.length])
}

function findMatchingParen(input: string, openParenIndex: number) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = openParenIndex; index < input.length; index++) {
    const char = input[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "(") {
      depth++
      continue
    }

    if (char === ")") {
      depth--
      if (depth === 0) return index
    }
  }

  return -1
}

function stableHash(input: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function collapseWhitespaceForHash(fpPolyExpr: string) {
  return fpPolyExpr.replace(/\s+/g, " ").trim()
}

function hasFpPolyIdentity(fpPolyExpr: string) {
  return /\(\s*(?:uuid|tstamp)(?:\s|\))/.test(fpPolyExpr)
}

export function addDeterministicFpPolyTstamps(kicadText: string) {
  let output = ""
  let cursor = 0

  for (let index = 0; index < kicadText.length; index++) {
    if (kicadText[index] !== "(" || !isFpPolyListAt(kicadText, index)) {
      continue
    }

    const closeParenIndex = findMatchingParen(kicadText, index)
    if (closeParenIndex === -1) break

    const fpPolyExpr = kicadText.slice(index, closeParenIndex + 1)
    if (!hasFpPolyIdentity(fpPolyExpr)) {
      const hash = stableHash(collapseWhitespaceForHash(fpPolyExpr))
      const tstamp = `kicad-to-circuit-json-fp-poly-${hash}`
      output += `${kicadText.slice(cursor, closeParenIndex)}\n    (tstamp "${tstamp}")`
      cursor = closeParenIndex
    }

    index = closeParenIndex
  }

  if (cursor === 0) return kicadText
  return output + kicadText.slice(cursor)
}
