import type { StaticDataPacked } from '../types.ts';
import { decodeStaticData } from './decode-impl.ts';
import { defaultDataset } from '../dataset';

const staticDataJson = await import('../assets/static.json');
const staticRecipesJson = await import('../assets/static-recipes.json');

const packed = {
  ...(staticDataJson.default as unknown as Omit<StaticDataPacked, 'recipes'>),
  recipes: staticRecipesJson.default.recipes,
} as StaticDataPacked;

export const staticData = decodeStaticData(packed);
export const staticDs = defaultDataset;
