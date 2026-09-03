import icons0Url from '../assets/icons-0.avif';
import icons0Data from '../assets/icons-0.json';
import icons1Url from '../assets/icons-1.avif';
import icons1Data from '../assets/icons-1.json';
import icons2Url from '../assets/icons-2.avif';
import icons2Data from '../assets/icons-2.json';
import icons3Url from '../assets/icons-3.avif';
import icons3Data from '../assets/icons-3.json';
import iconsUiUrl from '../assets/icons-ui.avif';
import iconsUiData from '../assets/icons-ui.json';

type Icon = [url: string, x: number, y: number];
type IconData = Record<string, [number, number]>;

function iconsFromSheet(url: string, data: unknown): Record<string, Icon> {
  return Object.fromEntries(
    Object.entries(data as IconData).map(([key, [x, y]]) => [key, [url, x, y]]),
  );
}

export const icons: Record<string, Icon> = {
  ...iconsFromSheet(icons0Url, icons0Data),
  ...iconsFromSheet(icons1Url, icons1Data),
  ...iconsFromSheet(icons2Url, icons2Data),
  ...iconsFromSheet(icons3Url, icons3Data),
  ...iconsFromSheet(iconsUiUrl, iconsUiData),
};
