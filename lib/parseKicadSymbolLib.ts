import type {
  KicadSymbolLib,
  KicadSymbolLibArc,
  KicadSymbolLibCircle,
  KicadSymbolLibFill,
  KicadSymbolLibPin,
  KicadSymbolLibPinAlternate,
  KicadSymbolLibPoint,
  KicadSymbolLibPolyline,
  KicadSymbolLibRectangle,
  KicadSymbolLibStroke,
  KicadSymbolLibSymbol,
  KicadSymbolLibText,
} from "./types"

type SExpr = string | SExpr[]

export function parseKicadSymbolLib(content: string): KicadSymbolLib {
  const expressions = parseSExpr(content)
  const root = expressions.find(
    (expr): expr is SExpr[] => isList(expr) && expr[0] === "kicad_symbol_lib",
  )

  if (!root) {
    throw new Error("Expected kicad_symbol_lib root in .kicad_sym file")
  }

  return {
    version: getChildScalar(root, "version"),
    generator: getChildScalar(root, "generator"),
    generatorVersion: getChildScalar(root, "generator_version"),
    symbols: getChildLists(root, "symbol").map(parseSymbol),
  }
}

function parseSExpr(content: string): SExpr[] {
  const tokens = tokenize(content)
  const expressions: SExpr[] = []
  let index = 0

  function parseList(): SExpr[] {
    const list: SExpr[] = []

    index++ // (
    while (index < tokens.length && tokens[index] !== ")") {
      if (tokens[index] === "(") {
        list.push(parseList())
      } else {
        list.push(tokens[index]!)
        index++
      }
    }

    if (tokens[index] !== ")") {
      throw new Error("Unterminated S-expression list")
    }

    index++ // )
    return list
  }

  while (index < tokens.length) {
    const token = tokens[index]
    if (token === "(") {
      expressions.push(parseList())
    } else if (token === ")") {
      throw new Error("Unexpected ')' in S-expression")
    } else if (token !== undefined) {
      expressions.push(token)
      index++
    }
  }

  return expressions
}

function tokenize(content: string): string[] {
  const tokens: string[] = []
  let index = 0

  while (index < content.length) {
    const char = content[index]

    if (/\s/.test(char)) {
      index++
      continue
    }

    if (char === ";") {
      while (index < content.length && content[index] !== "\n") index++
      continue
    }

    if (char === "(" || char === ")") {
      tokens.push(char)
      index++
      continue
    }

    if (char === '"') {
      let value = ""
      index++

      while (index < content.length) {
        const current = content[index]
        if (current === "\\") {
          const next = content[index + 1]
          if (next === undefined) {
            throw new Error("Unterminated escape sequence in quoted string")
          }
          value += next
          index += 2
          continue
        }

        if (current === '"') {
          index++
          break
        }

        value += current
        index++
      }

      tokens.push(value)
      continue
    }

    let value = ""
    while (
      index < content.length &&
      !/\s/.test(content[index]!) &&
      content[index] !== "(" &&
      content[index] !== ")"
    ) {
      value += content[index]
      index++
    }
    tokens.push(value)
  }

  return tokens
}

function parseSymbol(expr: SExpr[]): KicadSymbolLibSymbol {
  const name = getAtom(expr[1]) ?? ""
  const subSymbols = getChildLists(expr, "symbol").map(parseSymbol)
  const directPins = getChildLists(expr, "pin").map(parsePin)

  return {
    name,
    properties: Object.fromEntries(
      getChildLists(expr, "property").flatMap((property) => {
        const key = getAtom(property[1])
        const value = getAtom(property[2])
        return key ? [[key, value ?? ""]] : []
      }),
    ),
    pins: directPins,
    polylines: getChildLists(expr, "polyline").map(parsePolyline),
    rectangles: getChildLists(expr, "rectangle").map(parseRectangle),
    circles: getChildLists(expr, "circle").map(parseCircle),
    arcs: getChildLists(expr, "arc").map(parseArc),
    texts: getChildLists(expr, "text").map(parseText),
    subSymbols,
  }
}

function parsePin(expr: SExpr[]): KicadSymbolLibPin {
  const at = getChildList(expr, "at")
  const length = getChildScalar(expr, "length")

  return {
    electricalType: getAtom(expr[1]),
    graphicStyle: getAtom(expr[2]),
    at: at
      ? {
          x: parseNumber(getAtom(at[1])),
          y: parseNumber(getAtom(at[2])),
          angle: parseNumber(getAtom(at[3])),
        }
      : undefined,
    length: length !== undefined ? parseNumber(length) : undefined,
    hidden: getChildScalar(expr, "hide") === "yes",
    name: getChildScalar(expr, "name") ?? "",
    number: getChildScalar(expr, "number") ?? "",
    alternates: getChildLists(expr, "alternate").map(parseAlternate),
  }
}

function parseAlternate(expr: SExpr[]): KicadSymbolLibPinAlternate {
  return {
    name: getAtom(expr[1]) ?? "",
    electricalType: getAtom(expr[2]),
    graphicStyle: getAtom(expr[3]),
  }
}

function parsePolyline(expr: SExpr[]): KicadSymbolLibPolyline {
  const pts = getChildList(expr, "pts")

  return {
    points: pts ? getChildLists(pts, "xy").map(parseXy) : [],
    stroke: parseStroke(getChildList(expr, "stroke")),
    fill: parseFill(getChildList(expr, "fill")),
  }
}

function parseRectangle(expr: SExpr[]): KicadSymbolLibRectangle {
  return {
    start: parsePoint(getChildList(expr, "start")),
    end: parsePoint(getChildList(expr, "end")),
    stroke: parseStroke(getChildList(expr, "stroke")),
    fill: parseFill(getChildList(expr, "fill")),
  }
}

function parseCircle(expr: SExpr[]): KicadSymbolLibCircle {
  return {
    center: parsePoint(getChildList(expr, "center")),
    radius: parseNumber(getChildScalar(expr, "radius")),
    stroke: parseStroke(getChildList(expr, "stroke")),
    fill: parseFill(getChildList(expr, "fill")),
  }
}

function parseArc(expr: SExpr[]): KicadSymbolLibArc {
  return {
    start: parsePoint(getChildList(expr, "start")),
    mid: parsePoint(getChildList(expr, "mid")),
    end: parsePoint(getChildList(expr, "end")),
    stroke: parseStroke(getChildList(expr, "stroke")),
  }
}

function parseText(expr: SExpr[]): KicadSymbolLibText {
  const at = getChildList(expr, "at")
  const effects = getChildList(expr, "effects")
  const font = effects ? getChildList(effects, "font") : undefined
  const fontSize = font ? getChildList(font, "size") : undefined

  return {
    text: getAtom(expr[1]) ?? "",
    at: at
      ? {
          x: parseNumber(getAtom(at[1])),
          y: parseNumber(getAtom(at[2])),
          angle: parseNumber(getAtom(at[3])),
        }
      : { x: 0, y: 0, angle: 0 },
    fontSize: fontSize
      ? Math.max(
          parseNumber(getAtom(fontSize[1])),
          parseNumber(getAtom(fontSize[2])),
        )
      : undefined,
  }
}

function parseStroke(expr: SExpr[] | undefined): KicadSymbolLibStroke {
  if (!expr) return {}

  return {
    width: parseNumber(getChildScalar(expr, "width")),
    type: getChildScalar(expr, "type"),
  }
}

function parseFill(expr: SExpr[] | undefined): KicadSymbolLibFill {
  if (!expr) return {}

  return {
    type: getChildScalar(expr, "type"),
  }
}

function parseXy(expr: SExpr[]): KicadSymbolLibPoint {
  return {
    x: parseNumber(getAtom(expr[1])),
    y: parseNumber(getAtom(expr[2])),
  }
}

function parsePoint(expr: SExpr[] | undefined): KicadSymbolLibPoint {
  if (!expr) return { x: 0, y: 0 }

  return {
    x: parseNumber(getAtom(expr[1])),
    y: parseNumber(getAtom(expr[2])),
  }
}

function getChildScalar(expr: SExpr[], token: string): string | undefined {
  const child = getChildList(expr, token)
  if (!child) return undefined
  return getAtom(child[1])
}

function getChildList(expr: SExpr[], token: string): SExpr[] | undefined {
  return getChildLists(expr, token)[0]
}

function getChildLists(expr: SExpr[], token: string): SExpr[][] {
  return expr.filter(
    (child): child is SExpr[] => isList(child) && child[0] === token,
  )
}

function getAtom(expr: SExpr | undefined): string | undefined {
  return typeof expr === "string" ? expr : undefined
}

function isList(expr: SExpr): expr is SExpr[] {
  return Array.isArray(expr)
}

function parseNumber(value: string | undefined): number {
  if (value === undefined) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
