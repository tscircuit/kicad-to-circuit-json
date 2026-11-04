import { expect, test } from "bun:test"
import {
  getDroppedProjectFiles,
  getSelectedProjectFiles,
} from "../site/project-files"

test("file selection keeps every schematic and its relative path", () => {
  const files = Array.from({ length: 18 }, (_, index) => {
    const file = new File(["schematic"], `${index}.kicad_sch`)
    Object.defineProperty(file, "webkitRelativePath", {
      value: `project/sub/${file.name}`,
    })
    return file
  })
  const selected = getSelectedProjectFiles(files)
  expect(selected).toHaveLength(18)
  expect(selected[17]!.path).toBe("project/sub/17.kicad_sch")
  expect(selected[17]!.file).toBe(files[17]!)
})

test("dropping files without directory APIs keeps all files", async () => {
  const files = [
    new File(["root"], "root.kicad_sch"),
    new File(["child"], "child.kicad_sch"),
  ]
  const result = await getDroppedProjectFiles({
    files,
    items: [],
  } as unknown as DataTransfer)
  expect(result.map(({ path }) => path)).toEqual([
    "root.kicad_sch",
    "child.kicad_sch",
  ])
})

test("mixed entry APIs do not discard files whose entry is unavailable", async () => {
  const root = new File(["root"], "root.kicad_sch")
  const child = new File(["child"], "child.kicad_sch")
  const result = await getDroppedProjectFiles({
    items: [
      {
        webkitGetAsEntry: () => ({
          name: root.name,
          isFile: true,
          file: (resolve: (file: File) => void) => resolve(root),
        }),
      },
      { webkitGetAsEntry: () => null, getAsFile: () => child },
    ],
  } as unknown as DataTransfer)
  expect(result.map(({ path }) => path)).toEqual([root.name, child.name])
})

test("folder drops recurse into subdirectories and read every batch", async () => {
  const fileEntry = (name: string) => ({
    name,
    isFile: true,
    file: (resolve: (file: File) => void) =>
      resolve(new File(["schematic"], name)),
  })
  const directory = (name: string, batches: unknown[][]) => ({
    name,
    isFile: false,
    createReader: () => {
      let index = 0
      return {
        readEntries: (resolve: (entries: unknown[]) => void) =>
          resolve(batches[index++] ?? []),
      }
    },
  })
  const project = directory("project", [
    [fileEntry("root.kicad_sch")],
    [directory("sub", [[fileEntry("child.kicad_sch")]])],
  ])
  const result = await getDroppedProjectFiles({
    items: [{ webkitGetAsEntry: () => project }],
  } as unknown as DataTransfer)
  expect(result.map(({ path }) => path)).toEqual([
    "project/root.kicad_sch",
    "project/sub/child.kicad_sch",
  ])
})

test("folder read failures propagate instead of silently omitting sheets", async () => {
  const transfer = {
    items: [
      {
        webkitGetAsEntry: () => ({
          name: "child.kicad_sch",
          isFile: true,
          file: (_resolve: unknown, reject: (error: Error) => void) =>
            reject(new Error("File unreadable")),
        }),
      },
    ],
  }
  expect(
    getDroppedProjectFiles(transfer as unknown as DataTransfer),
  ).rejects.toThrow("File unreadable")
})
