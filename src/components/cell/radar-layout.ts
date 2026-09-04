const maxAssemblerStackHeight = 100;

export function assemblerColumnLayout(machineWidth: number, machineHeight: number, count: number) {
  const rowsPerColumn = Math.max(1, Math.floor(maxAssemblerStackHeight / machineHeight));
  const columnCount = Math.ceil(count / rowsPerColumn);

  return {
    assemblers: Array.from({ length: count }, (_, index) => ({
      column: Math.floor(index / rowsPerColumn),
      row: index % rowsPerColumn,
    })),
    height: Math.min(count, rowsPerColumn) * machineHeight,
    width: columnCount * machineWidth + Math.max(0, columnCount - 1) * 4,
  };
}
