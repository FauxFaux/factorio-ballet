import type { StaticDataPacked } from '../../types.ts';
import { decodeStaticData } from '../../data/decode-impl.ts';
import { iconsFromSheet, preloadImage } from '../../data/icon-map.ts';
import iconsUrl from '../../assets/dataset/space-age/icons.avif';
import type { DatasetInput } from '../types.ts';

export async function spaceAge(): Promise<DatasetInput> {
  const [dataJson, recipesJson, iconsJson] = await Promise.all([
    import('../../assets/dataset/space-age/static.json'),
    import('../../assets/dataset/space-age/recipes.json'),
    import('../../assets/dataset/space-age/icons.json'),
  ]);
  const packed = {
    ...(dataJson.default as unknown as Omit<StaticDataPacked, 'recipes'>),
    recipes: recipesJson.default.recipes,
  } as StaticDataPacked;

  if (typeof Image !== 'undefined') void preloadImage(iconsUrl);
  return {
    staticData: decodeStaticData(packed),
    iconMap: iconsFromSheet(iconsUrl, iconsJson.default, 896),
  };
}
