export interface ProjectFile {
  path: string
  file: File
}

export function getSelectedProjectFiles(
  files: FileList | File[],
): ProjectFile[] {
  return Array.from(files, (file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }))
}

export async function getDroppedProjectFiles(
  transfer: DataTransfer,
): Promise<ProjectFile[]> {
  // Capture entries before the drop event's data store becomes unavailable.
  const items = Array.from(transfer.items ?? [], (item) => ({
    entry: item.webkitGetAsEntry?.(),
    file: item.getAsFile?.(),
  }))
  if (!items.some(({ entry }) => entry))
    return getSelectedProjectFiles(transfer.files)

  const visit = async (
    entry: FileSystemEntry,
    parent = "",
  ): Promise<ProjectFile[]> => {
    const path = `${parent}${entry.name}`
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      )
      return [{ path, file }]
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const children: FileSystemEntry[] = []
    // Chromium returns directory contents in batches, often 100 at a time.
    while (true) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      )
      if (!batch.length) break
      children.push(...batch)
    }
    return (
      await Promise.all(children.map((child) => visit(child, `${path}/`)))
    ).flat()
  }
  return (
    await Promise.all(
      items.map(({ entry, file }) =>
        entry ? visit(entry) : file ? getSelectedProjectFiles([file]) : [],
      ),
    )
  ).flat()
}
