export type Icon = [url: string, x: number, y: number, sheetWidth: number, sheetHeight: number];
type IconData = Record<string, [number, number]>;

export type IconMap = Record<string, Icon>;

export function iconsFromSheet(
  url: string,
  data: unknown,
  sheetWidth: number,
  sheetHeight = sheetWidth,
): IconMap {
  return Object.fromEntries(
    Object.entries(data as IconData).map(([key, [x, y]]) => [
      key,
      [url, x, y, sheetWidth, sheetHeight],
    ]),
  );
}

export async function preloadImage(url: string) {
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
  } catch (err) {
    console.log('preload failed, ignoring', url, err);
  }
}
