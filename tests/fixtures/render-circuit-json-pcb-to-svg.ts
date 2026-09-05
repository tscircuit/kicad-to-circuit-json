import { createCanvas, SvgExportFlag } from "@napi-rs/canvas"
import type { CircuitJson, PcbBoard } from "circuit-json"
import { CircuitToCanvasDrawer } from "circuit-to-canvas"

type BoardBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function getBoardBounds(board: PcbBoard): BoardBounds {
  if (board.outline && board.outline.length >= 3) {
    const xCoordinates = board.outline.map((point) => point.x)
    const yCoordinates = board.outline.map((point) => point.y)

    return {
      minX: Math.min(...xCoordinates),
      maxX: Math.max(...xCoordinates),
      minY: Math.min(...yCoordinates),
      maxY: Math.max(...yCoordinates),
    }
  }

  if (board.width && board.height) {
    return {
      minX: board.center.x - board.width / 2,
      maxX: board.center.x + board.width / 2,
      minY: board.center.y - board.height / 2,
      maxY: board.center.y + board.height / 2,
    }
  }

  throw new Error("Expected the PCB board to have an outline or dimensions")
}

export function renderCircuitJsonPcbToSvg({
  circuitJson,
  width = 800,
}: {
  circuitJson: CircuitJson
  width?: number
}): string {
  const board = circuitJson.find(
    (element): element is PcbBoard => element.type === "pcb_board",
  )
  if (!board) throw new Error("Expected Circuit JSON to contain a PCB board")

  const bounds = getBoardBounds(board)
  const boardWidth = bounds.maxX - bounds.minX
  const boardHeight = bounds.maxY - bounds.minY
  if (!(boardWidth > 0) || !(boardHeight > 0)) {
    throw new Error("Expected the PCB board to have positive dimensions")
  }

  const height = Math.max(1, Math.round((width * boardHeight) / boardWidth))
  const canvas = createCanvas(width, height, SvgExportFlag.ConvertTextToPaths)
  const context = canvas.getContext("2d")
  context.fillStyle = "#000"
  context.fillRect(0, 0, width, height)

  const drawer = new CircuitToCanvasDrawer(canvas)
  drawer.setCameraBounds(bounds)
  drawer.drawElements(circuitJson, {
    drawBoardMaterial: false,
    layers: [
      "top_copper",
      "bottom_copper",
      "top_silkscreen",
      "bottom_silkscreen",
      "edge_cuts",
      "drill",
    ],
  })

  return canvas.getContent().toString("utf8")
}
