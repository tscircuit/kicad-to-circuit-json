import { Polygon } from "@flatten-js/core"
import type { Point } from "../../../types"

const ENDPOINT_TOLERANCE = 1e-6

/** Join footprint-local paths after placement, without inventing closing edges. */
export function assembleCourtyardContours(routes: Point[][]): {
  outlines: Point[][]
  invalidCount: number
} {
  const nodes: Array<{ point: Point; edges: number[] }> = []
  const edges: Array<{ route: Point[]; start: number; end: number }> = []
  const outlines: Point[][] = []
  let invalidCount = 0
  const getNode = (point: Point) => {
    const existing = nodes.findIndex(
      (node) =>
        Math.hypot(node.point.x - point.x, node.point.y - point.y) <=
        ENDPOINT_TOLERANCE,
    )
    if (existing !== -1) return existing
    nodes.push({ point, edges: [] })
    return nodes.length - 1
  }

  for (const route of routes) {
    if (
      route.length < 2 ||
      route.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    ) {
      invalidCount++
      continue
    }
    const start = getNode(route[0]!)
    const end = getNode(route[route.length - 1]!)
    const index = edges.length
    edges.push({ route, start, end })
    nodes[start]!.edges.push(index)
    nodes[end]!.edges.push(index)
  }

  const visited = new Set<number>()
  for (let first = 0; first < edges.length; first++) {
    if (visited.has(first)) continue
    const connectedEdges = new Set<number>()
    const connectedNodes = new Set<number>()
    const pending = [edges[first]!.start]
    while (pending.length) {
      const node = pending.pop()!
      if (connectedNodes.has(node)) continue
      connectedNodes.add(node)
      for (const index of nodes[node]!.edges) {
        connectedEdges.add(index)
        const edge = edges[index]!
        pending.push(edge.start, edge.end)
      }
    }
    for (const index of connectedEdges) visited.add(index)
    if ([...connectedNodes].some((node) => nodes[node]!.edges.length !== 2)) {
      invalidCount++
      continue
    }

    const remaining = new Set(connectedEdges)
    const outline: Point[] = []
    let currentNode = edges[first]!.start
    while (remaining.size) {
      const index = nodes[currentNode]!.edges.find((i) => remaining.has(i))!
      const edge = edges[index]!
      remaining.delete(index)
      const forward = currentNode === edge.start
      const points = forward ? edge.route : [...edge.route].reverse()
      if (outline.length === 0) outline.push(nodes[currentNode]!.point)
      outline.push(...points.slice(1, -1))
      currentNode = forward ? edge.end : edge.start
      outline.push(nodes[currentNode]!.point)
    }
    // Circuit JSON closes outlines implicitly. Strip the repeated endpoint.
    outline.pop()
    if (outline.length < 3) {
      invalidCount++
      continue
    }
    const polygon = new Polygon(outline.map((p) => [p.x, p.y]))
    if (polygon.area() <= 1e-12 || !polygon.isValid()) {
      invalidCount++
      continue
    }
    outlines.push(outline)
  }
  return { outlines, invalidCount }
}
