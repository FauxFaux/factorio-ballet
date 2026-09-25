import type { StaticDataPacked } from '../types.ts';
import { decodeStaticData } from './decode-impl.ts';

const staticDataJson = await import('../assets/dataset/bobang/static.json');
const staticRecipesJson = await import('../assets/dataset/bobang/static-recipes.json');

const packed = {
  ...(staticDataJson.default as unknown as Omit<StaticDataPacked, 'recipes'>),
  recipes: staticRecipesJson.default.recipes,
} as StaticDataPacked;

export const staticData = decodeStaticData(packed);
