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
  const [dataJson, recipesJson, iconsUiJson, icons0Json, icons1Json, icons2Json, icons3Json] =
    await Promise.all([
      import('../../assets/dataset/bobang/static.json'),
      import('../../assets/dataset/bobang/static-recipes.json'),
      import('../../assets/dataset/bobang/icons-ui.json'),
      import('../../assets/dataset/bobang/icons-0.json'),
      import('../../assets/dataset/bobang/icons-1.json'),
      import('../../assets/dataset/bobang/icons-2.json'),
      import('../../assets/dataset/bobang/icons-3.json'),
    ]);

  const packed = {
    ...(dataJson.default as unknown as Omit<StaticDataPacked, 'recipes'>),
    recipes: recipesJson.default.recipes,
  } as StaticDataPacked;

  const staticData = decodeStaticData(packed);

  const iconMap: IconMap = {
    ...iconsFromSheet(icons0Url, icons0Json.default, 864),
    ...iconsFromSheet(icons1Url, icons1Json.default, 864),
    ...iconsFromSheet(icons2Url, icons2Json.default, 864),
    ...iconsFromSheet(icons3Url, icons3Json.default, 864),
    ...iconsFromSheet(iconsUiUrl, iconsUiJson.default, 480),
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
