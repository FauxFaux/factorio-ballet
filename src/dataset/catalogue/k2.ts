import { upstreamInserterPerformance } from '../../data/inserter-performance-upstream.ts';
import type { StaticDataPacked } from '../../types.ts';
import { decodeStaticData } from '../../data/decode-impl.ts';
import { iconsFromSheet, preloadImage } from '../../data/icon-map.ts';
import iconsUrl from '../../assets/dataset/k2/icons.avif';
import type { DatasetInput } from '../types.ts';

export async function k2(): Promise<DatasetInput> {
  const [dataJson, recipesJson, iconsJson] = await Promise.all([
    import('../../assets/dataset/k2/static.json'),
    import('../../assets/dataset/k2/recipes.json'),
    import('../../assets/dataset/k2/icons.json'),
  ]);
  const packed = {
    ...(dataJson.default as unknown as Omit<StaticDataPacked, 'recipes'>),
    recipes: recipesJson.default.recipes,
  } as StaticDataPacked;

  if (typeof Image !== 'undefined') void preloadImage(iconsUrl);
  return {
    inserterPerformance: upstreamInserterPerformance,
    staticData: decodeStaticData(packed),
    iconMap: iconsFromSheet(iconsUrl, iconsJson.default, 1056, 1056),
  };
}
