import type { StaticDataPacked } from '../../types.ts';
import { decodeStaticData } from '../../data/decode-impl.ts';
import icons0Url from '../../assets/dataset/bobang/icons-0.avif';
import icons1Url from '../../assets/dataset/bobang/icons-1.avif';
import icons2Url from '../../assets/dataset/bobang/icons-2.avif';
import icons3Url from '../../assets/dataset/bobang/icons-3.avif';
import iconsUiUrl from '../../assets/dataset/bobang/icons-ui.avif';
import { type IconMap, iconsFromSheet, preloadImage } from '../../data/icon-map.ts';
import type { DatasetInput } from '../types.ts';

export async function bobAngs(): Promise<DatasetInput> {
  const [dataJson, recipesJson, icons] = await Promise.all([
    import('../../assets/dataset/bobang/static.json'),
    import('../../assets/dataset/bobang/static-recipes.json'),
    import('./bobang-icons.ts'),
  ]);

  const packed = {
    ...(dataJson.default as unknown as Omit<StaticDataPacked, 'recipes'>),
    recipes: recipesJson.default.recipes,
  } as StaticDataPacked;

  const staticData = decodeStaticData(packed);

  const iconMap: IconMap = {
    ...iconsFromSheet(icons0Url, icons.icons0Json, 864),
    ...iconsFromSheet(icons1Url, icons.icons1Json, 864),
    ...iconsFromSheet(icons2Url, icons.icons2Json, 864),
    ...iconsFromSheet(icons3Url, icons.icons3Json, 864),
    ...iconsFromSheet(iconsUiUrl, icons.iconsUiJson, 480),
  };

  setTimeout(preloadImages, 0);

  return { staticData, iconMap };
}

function preloadImages() {
  if (typeof Image === 'undefined') return;

  void (async () => {
    await preloadImage(iconsUiUrl);
    await preloadImage(icons0Url);
    await Promise.all([preloadImage(icons1Url), preloadImage(icons2Url), preloadImage(icons3Url)]);
  })();
}
