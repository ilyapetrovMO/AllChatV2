/** Largest equal 16:9 cells that fit the room, including gaps between rows. */
export function voiceGridLayout(count: number, width: number, height: number, gap = 12) {
  let best = { columns: 0, rows: 0, width: 0, height: 0 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const cellWidth = Math.min(
      (width - gap * (columns - 1)) / columns,
      ((height - gap * (rows - 1)) / rows) * 16 / 9,
    );
    if (cellWidth > best.width) {
      best = { columns, rows, width: cellWidth, height: cellWidth * 9 / 16 };
    }
  }
  return best;
}
