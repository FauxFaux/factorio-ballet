import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode } from '../../src/bp/decode.ts';
import { allRedGreen } from '../../scripts/k2-milestones.ts';
import { sha256 } from '../../scripts/milestones/extract.ts';
import {
  bill,
  blueprintMilestone,
  closure,
  compare,
  EMPTY_MILESTONE,
  researchFor,
  scienceCost,
} from '../../scripts/milestones/model.ts';
import type { MilestoneData } from '../../scripts/milestones/model.ts';

const data = JSON.parse(readFileSync('docs/milestones/k2-data.json', 'utf8')) as MilestoneData;
const blueprint = (id: string) =>
  blueprintMilestone(data, decode(readFileSync(`docs/blueprints/${id}.base64`, 'utf8')));
const fixture = (): MilestoneData => ({
  provenance: { dataset: 'test', rawSha256: '', staticSha256: '', recipesSha256: '' },
  boundaries: { plates: ['item:iron-plate'], raw: ['item:iron-plate'] },
  technologies: {
    root: { human: 'root', prerequisites: [], science: { red: 10 }, complexity: 0, unlocks: [] },
    left: {
      human: 'left',
      prerequisites: ['root'],
      science: { red: 20 },
      complexity: 0,
      unlocks: [],
    },
    right: {
      human: 'right',
      prerequisites: ['root'],
      science: { red: 30 },
      complexity: 0,
      unlocks: [],
    },
  },
  buildings: {},
  recipes: {},
  routes: {},
});

describe('milestone accounting', () => {
  it('counts shared research once and charges only research missing from the baseline', () => {
    const d = fixture();
    d.boundaries.plates.push('item:red');
    d.boundaries.raw.push('item:red');
    const before = { buildings: {}, recipes: [], technologies: ['left'] };
    const after = { buildings: {}, recipes: [], technologies: ['left', 'right'] };
    expect(scienceCost(d, closure(d, ['left', 'right']))).toEqual({ red: 60 });
    expect(compare(d, before, after).science).toEqual({ red: 30 });
  });

  it('pools intermediates across products before rounding multi-item crafts', () => {
    const d = fixture();
    d.recipes = {
      a: { product: 'item:a', yield: 1, expectedYield: false, ingredients: { 'item:part': 1 } },
      b: { product: 'item:b', yield: 1, expectedYield: false, ingredients: { 'item:part': 1 } },
      part: {
        product: 'item:part',
        yield: 2,
        expectedYield: false,
        ingredients: { 'item:iron-plate': 3 },
      },
    };
    d.routes = { 'item:a': 'a', 'item:b': 'b', 'item:part': 'part' };
    const result = bill(d, { 'item:a': 1, 'item:b': 1, 'item:part': 1 }, d.boundaries.plates, true);
    expect(result.materials).toEqual({ 'item:iron-plate': 6 });
    expect(result.surplus).toEqual({ 'item:part': 1 });
    expect(bill(d, { 'item:a': 1 }, d.boundaries.plates).materials).toEqual({
      'item:iron-plate': 1.5,
    });
  });

  it('reports removed buildings without turning their ingredients into material credit', () => {
    const before = { buildings: { 'electric-furnace': 1 }, recipes: [], technologies: [] };
    const after = { buildings: { 'stone-furnace': 1 }, recipes: [], technologies: [] };
    const result = compare(data, before, after);
    expect(result.removed).toEqual({ 'item:electric-furnace': 1 });
    expect(result.construction.materials).toEqual({ 'item:stone': 5 });
    expect(result.science).toEqual({});
  });

  it('uses a removed assembler as an upgrade ingredient rather than crafting it again', () => {
    const before = { buildings: { 'assembling-machine-1': 1 }, recipes: [], technologies: [] };
    const after = { buildings: { 'assembling-machine-2': 1 }, recipes: [], technologies: [] };
    const result = compare(data, before, after);
    expect(result.construction.reused).toEqual({ 'item:assembling-machine-1': 1 });
    expect(result.construction.materials['item:iron-plate']).toBe(10.5);
    expect(result.construction.materials['item:copper-plate']).toBe(3);
    expect(result.total.reused).toEqual(result.construction.reused);
  });

  it('rejects cycles, unknown routes, non-finite quantities, and unspecified infinite research levels', () => {
    const d = fixture();
    d.recipes.loop = {
      product: 'item:loop',
      yield: 1,
      expectedYield: false,
      ingredients: { 'item:loop': 1 },
    };
    d.routes['item:loop'] = 'loop';
    expect(() => bill(d, { 'item:loop': 1 }, [])).toThrow('Production cycle');
    expect(() => bill(d, { 'item:missing': 1 }, [])).toThrow('No production route');
    expect(() => bill(d, { 'item:iron-plate': Infinity }, [])).toThrow('Invalid demand');
    d.technologies.root.formula = '100*L';
    expect(() => scienceCost(d, ['root'])).toThrow('Research level required');
  });
});

describe('K2 milestone evidence', () => {
  it('keeps snapshot provenance tied to both ingested K2 files and the actual blueprints', () => {
    expect(data.provenance.staticSha256).toBe(
      sha256(readFileSync('src/assets/dataset/k2/static.json', 'utf8')),
    );
    expect(data.provenance.recipesSha256).toBe(
      sha256(readFileSync('src/assets/dataset/k2/recipes.json', 'utf8')),
    );
    const reports = JSON.parse(readFileSync('docs/milestones/k2-costs.json', 'utf8'));
    for (const id of ['m1', 'm2']) {
      expect(reports.provenance.blueprintHashes[id]).toBe(
        sha256(readFileSync(`docs/blueprints/${id}.base64`, 'utf8')),
      );
      expect(reports.blueprints[id]).toEqual(blueprint(id));
    }
    expect(reports.scenarios['m1-to-m2'].total).toEqual(
      compare(data, blueprint('m1'), blueprint('m2')).total.materials,
    );
  });

  it('counts both representative bases and costs the 5,069 additional entities', () => {
    const m1 = blueprint('m1');
    const m2 = blueprint('m2');
    expect(Object.values(m1.buildings).reduce((a, b) => a + b, 0)).toBe(1651);
    expect(Object.values(m2.buildings).reduce((a, b) => a + b, 0)).toBe(6720);
    expect(m1.buildings['stone-furnace']).toBe(108);
    expect(m2.buildings['electric-mining-drill']).toBe(127);
    const result = compare(data, m1, m2);
    expect(Object.values(result.added).reduce((a, b) => a + b, 0)).toBe(5069);
    expect(result.removed).toEqual({});
    expect(result.science).toEqual({
      'kr-basic-tech-card': 20,
      'automation-science-pack': 740,
      'logistic-science-pack': 720,
    });
    expect(result.construction.materials['item:iron-plate']).toBe(11944.5);
    expect(result.total.materials['item:iron-plate']).toBe(14052.5);
    expect(result.total.materials['item:copper-plate']).toBe(5432);
    expect(result.uncountedCraftingMachines).toEqual(['chemical-plant', 'oil-refinery']);
    expect(
      compare(data, m1, m2, data.boundaries.plates, true).total.materials['item:iron-plate'],
    ).toBe(14066);
    expect(compare(data, m1, m2, data.boundaries.raw).total.materials['item:iron-ore']).toBe(28105);
  });

  it('includes configured production goals but does not buy all earlier optional technologies', () => {
    const milestone = blueprint('m1');
    const required = researchFor(data, milestone).technologies;
    expect(required).toContain('kr-silicon-processing');
    expect(required).not.toContain('kr-light-armor');
    expect(required).not.toContain('kr-iron-pickaxe');
    const withoutGoals = researchFor(data, { ...milestone, recipes: [] }).technologies;
    expect(required).toContain('advanced-material-processing');
    expect(withoutGoals).not.toContain('advanced-material-processing');
  });

  it('prices military cards using gathered biomass rather than a later biomass production loop', () => {
    const result = bill(data, { 'item:military-science-pack': 50 }, data.boundaries.plates);
    expect(result.materials['item:kr-biomass']).toBe(20);
    expect(result.crafts['kr-biomass']).toBeUndefined();
    const flame = compare(data, EMPTY_MILESTONE, {
      buildings: { 'flamethrower-turret': 1 },
      recipes: [],
      technologies: [],
    });
    expect(flame.science['military-science-pack']).toBe(50);
    expect(flame.total.materials['item:kr-biomass']).toBe(20);
    expect(flame.technologies).not.toContain('kr-bio-processing');
  });

  it('distinguishes completing red/green research from taking the electric-furnace prerequisite path', () => {
    const before = { buildings: {}, recipes: [], technologies: allRedGreen(data) };
    expect(before.technologies).toHaveLength(86);
    expect(before.technologies).toContain('kr-light-armor');
    const result = compare(data, before, {
      buildings: { 'electric-furnace': 1 },
      recipes: [],
      technologies: [],
    });
    expect(result.science).toEqual({
      'automation-science-pack': 250,
      'logistic-science-pack': 250,
      'chemical-science-pack': 250,
    });
    expect(result.construction.materials['item:iron-plate']).toBe(25);
  });

  it('rejects unaccounted blueprint inventory, tiles, unknown entities and quality', () => {
    const entity = { entity_number: 1, name: 'lab', position: { x: 0, y: 0 } };
    expect(() =>
      blueprintMilestone(data, {
        item: 'blueprint',
        version: 0,
        entities: [{ ...entity, items: { 'speed-module': 1 } }],
      }),
    ).toThrow('Item requests');
    expect(() =>
      blueprintMilestone(data, {
        item: 'blueprint',
        version: 0,
        tiles: [{ name: 'concrete', position: { x: 0, y: 0 } }],
      }),
    ).toThrow('Tile costs');
    expect(() =>
      blueprintMilestone(data, {
        item: 'blueprint',
        version: 0,
        entities: [{ ...entity, name: 'unknown' }],
      }),
    ).toThrow('Unknown planning building');
    const qualityEntity = { ...entity, quality: 'rare' };
    expect(() =>
      blueprintMilestone(data, { item: 'blueprint', version: 0, entities: [qualityEntity] }),
    ).toThrow('Unsupported quality');
  });
});
