import { expect, it } from 'vitest';
import { datasetCatalogue } from '../src/dataset/catalogue.ts';

it('loads k2 recipes, localized resources, and matching icon sheet geometry', async () => {
  const { staticData, iconMap } = await datasetCatalogue.k2.load();
  expect(Object.keys(staticData.recipes)).toHaveLength(530);
  expect(staticData.resources['item:kr-basic-tech-card'].human).toBe('Basic tech card');
  expect(staticData.recipes['kr-coke-liquefaction']).toBeDefined();
  expect(iconMap['item:kr-basic-tech-card']?.slice(3)).toEqual([1056, 1056]);
});
