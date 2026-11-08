#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decode } from '../src/bp/decode.ts';
import { extract, sha256 } from './milestones/extract.ts';
import {
  bill,
  blueprintMilestone,
  closure,
  compare,
  EMPTY_MILESTONE,
  researchFor,
  scienceCost,
} from './milestones/model.ts';
import type { Amounts, Milestone, MilestoneData } from './milestones/model.ts';

const DIR = 'docs/milestones';
const DATA = `${DIR}/k2-data.json`;
const PACKS = [
  'kr-basic-tech-card',
  'automation-science-pack',
  'logistic-science-pack',
  'military-science-pack',
  'chemical-science-pack',
];

export function allRedGreen(data: MilestoneData): string[] {
  return Object.keys(data.technologies).filter((id) =>
    closure(data, [id]).every((t) => {
      const tech = data.technologies[t];
      return !tech.formula && Object.keys(tech.science).every((p) => PACKS.slice(0, 3).includes(p));
    }),
  );
}

async function loadMilestone(data: MilestoneData, name: string): Promise<Milestone> {
  if (name === 'empty') return EMPTY_MILESTONE;
  if (name === 'all-red-green')
    return { buildings: {}, recipes: [], technologies: allRedGreen(data) };
  if (name === 'chemical-ready')
    return { buildings: {}, recipes: ['chemical-science-pack'], technologies: [] };
  if (name.startsWith('tech:'))
    return { buildings: {}, recipes: [], technologies: name.slice(5).split(',') };
  if (name.startsWith('item:'))
    return { buildings: { [name.slice(5)]: 1 }, recipes: [], technologies: [] };
  const path = ['m1', 'm2'].includes(name) ? `docs/blueprints/${name}.base64` : name;
  const text = await readFile(path, 'utf8');
  if (!path.endsWith('.json')) return blueprintMilestone(data, decode(text));
  const input = JSON.parse(text) as Milestone;
  if (!input.buildings || !Array.isArray(input.recipes) || !Array.isArray(input.technologies))
    throw new Error('Milestone JSON must contain buildings, recipes, and technologies');
  for (const [id, n] of Object.entries(input.buildings)) {
    if (!data.buildings[id]) throw new Error(`Unknown planning building: ${id}`);
    if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid building count ${id}: ${n}`);
  }
  return input;
}

function cardVector(science: Amounts): string {
  return PACKS.map((id) => science[id] ?? 0).join(' / ');
}

function summary(result: ReturnType<typeof compare>) {
  return {
    added: result.added,
    removed: result.removed,
    reusedAsIngredients: result.total.reused,
    technologies: result.technologies,
    triggers: result.triggers,
    science: result.science,
    construction: result.construction.materials,
    research: result.research.materials,
    total: result.total.materials,
    expectedYieldRecipes: result.total.expectedYields,
    requiredCraftingMachines: result.requiredCraftingMachines,
    uncountedCraftingMachines: result.uncountedCraftingMachines,
  };
}

async function writeReports(data: MilestoneData) {
  const m1 = await loadMilestone(data, 'm1');
  const m2 = await loadMilestone(data, 'm2');
  const scenarios: Record<string, ReturnType<typeof summary>> = {};
  for (const [key, from, to] of [
    ['empty-to-m1', 'empty', 'm1'],
    ['empty-to-m2', 'empty', 'm2'],
    ['m1-to-m2', 'm1', 'm2'],
    ['chemical-ready', 'empty', 'chemical-ready'],
    ['all-red-green', 'empty', 'all-red-green'],
    ['electric-furnace', 'empty', 'item:electric-furnace'],
    ['flamethrower-turret', 'empty', 'item:flamethrower-turret'],
  ])
    scenarios[key] = summary(
      compare(data, await loadMilestone(data, from), await loadMilestone(data, to)),
    );
  const blueprintHashes: Record<string, string> = {};
  for (const id of ['m1', 'm2'])
    blueprintHashes[id] = sha256(await readFile(`docs/blueprints/${id}.base64`, 'utf8'));
  const unitCosts = Object.fromEntries(
    Object.keys(data.buildings)
      .sort()
      .map((id) => [
        id,
        {
          plates: bill(data, { [`item:${id}`]: 1 }, data.boundaries.plates).materials,
          raw: bill(data, { [`item:${id}`]: 1 }, data.boundaries.raw).materials,
          ...researchFor(data, { buildings: { [id]: 1 }, recipes: [], technologies: [] }),
        },
      ]),
  );
  await writeFile(
    `${DIR}/k2-costs.json`,
    JSON.stringify(
      {
        provenance: { ...data.provenance, blueprintHashes },
        accounting:
          'Expected material equivalents, no productivity or fuel; reuse prior building inventory; research from required prerequisite closure, not all earlier complexity entries.',
        blueprints: { m1, m2 },
        scenarios,
        unitCosts,
      },
      null,
      2,
    ) + '\n',
  );

  const core = new Set([
    ...scenarios['chemical-ready'].technologies,
    ...scenarios['electric-furnace'].technologies,
  ]);
  const early = Object.keys(data.technologies)
    .filter(
      (id) =>
        data.technologies[id].complexity <=
          data.technologies['advanced-material-processing-2'].complexity || id === 'flamethrower',
    )
    .sort(
      (a, b) =>
        data.technologies[a].complexity - data.technologies[b].complexity || a.localeCompare(b),
    );
  const children = new Set(Object.values(data.technologies).flatMap((t) => t.prerequisites));
  const grouped = new Map<string, string[]>();
  for (const id of Object.keys(data.buildings)) {
    const technology =
      data.recipes[data.routes[`item:${id}`]].technology ?? '(available initially)';
    grouped.set(technology, [...(grouped.get(technology) ?? []), id]);
  }
  const lines = [
    '# K2 early unlock catalogue',
    '',
    'Generated by `APP=~/ins/factorio/2.1.21 node scripts/k2-milestones.ts --refresh`.',
    'Read [README.md](README.md) for accounting rules, route choices, commands, and interpretation.',
    '',
    'Order follows the existing complexity model through electric furnaces, with flamethrower added explicitly.',
    'Its military weighting is distorted by gathered biomass; percentages are reference scores, not research requirements.',
    'Card vectors below are **basic / automation / logistic / military / chemical**.',
    '',
    '## Building unlocks',
    '',
    'One row per placing item (including logistics, defenses, rails and vehicles; decorative trees/rocks excluded).',
    'Costs are per item, including all crafted intermediates. Iron includes iron consumed in steel.',
    'Full unit material vectors, prerequisites and crafting machines are in `k2-costs.json.unitCosts`.',
    '',
    '| Building item | Unlock technology | Complexity % | Iron plates | Copper plates |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  for (const id of Object.keys(data.buildings).sort(
    (a, b) => data.buildings[a].complexity - data.buildings[b].complexity || a.localeCompare(b),
  )) {
    const b = data.buildings[id];
    const cost = unitCosts[id].plates;
    const tech = data.recipes[data.routes[`item:${id}`]].technology ?? 'initial';
    lines.push(
      `| ${b.human} (\`${id}\`) | \`${tech}\` | ${(100 * b.complexity).toFixed(2)} | ${cost['item:iron-plate'] ?? 0} | ${cost['item:copper-plate'] ?? 0} |`,
    );
  }
  lines.push(
    '',
    '## Technology choices and dead ends',
    '',
    '**Core** means required to make chemical cards or one electric furnace with the selected early routes.',
    '**Side** means optional for those two goals. **Leaf** means no technology in the entire exported tree names it as a prerequisite.',
    'A leaf can still be useful (inserter settings, combat bonuses, equipment, a better machine); complexity sorting does not make it compulsory.',
    'Closure costs here count declared technology prerequisites only; blueprint scenarios additionally include material and crafting-machine unlocks.',
    '',
    '| Technology | Choice | Own cards | Prerequisite closure cards | Building unlocks |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const id of early) {
    const t = data.technologies[id];
    lines.push(
      `| ${t.human} (\`${id}\`) | ${core.has(id) ? 'core' : 'side'}${children.has(id) ? '' : ', leaf'} | ${cardVector(t.science)} | ${cardVector(scienceCost(data, closure(data, [id])))} | ${(
        grouped.get(id) ?? []
      )
        .sort()
        .map((b) => `\`${b}\``)
        .join(', ')} |`,
    );
  }
  lines.push(
    '',
    '## Blueprint inventory',
    '',
    'Counts are placing items. The sample blueprints use one item per entity and have no tiles or item requests.',
    '',
    '| Building item | m1 | m2 | Added | Removed |',
    '| --- | ---: | ---: | ---: | ---: |',
  );
  for (const id of [
    ...new Set([...Object.keys(m1.buildings), ...Object.keys(m2.buildings)]),
  ].sort()) {
    const a = m1.buildings[id] ?? 0;
    const b = m2.buildings[id] ?? 0;
    lines.push(`| \`${id}\` | ${a} | ${b} | ${Math.max(0, b - a)} | ${Math.max(0, a - b)} |`);
  }
  lines.push(
    `| **Total** | **${Object.values(m1.buildings).reduce((a, b) => a + b, 0)}** | **${Object.values(m2.buildings).reduce((a, b) => a + b, 0)}** | **${Object.values(scenarios['m1-to-m2'].added).reduce((a, b) => a + b, 0)}** | **${Object.values(scenarios['m1-to-m2'].removed).reduce((a, b) => a + b, 0)}** |`,
    '',
    '## Cost scenarios',
    '',
    'The furnace and flamethrower rows include one building plus its required research. Other named research goals have no building quantities.',
    '',
    '| Scenario | Cards (basic / red / green / military / blue) | Construction iron | Research iron | Combined iron |',
    '| --- | --- | ---: | ---: | ---: |',
  );
  for (const [id, s] of Object.entries(scenarios))
    lines.push(
      `| \`${id}\` | ${cardVector(s.science)} | ${s.construction['item:iron-plate'] ?? 0} | ${s.research['item:iron-plate'] ?? 0} | ${s.total['item:iron-plate'] ?? 0} |`,
    );
  lines.push(
    '',
    '## Materials between m1 and m2',
    '',
    '| Input | Added buildings | New research | Combined |',
    '| --- | ---: | ---: | ---: |',
  );
  const delta = scenarios['m1-to-m2'];
  for (const id of Object.keys(delta.total))
    lines.push(
      `| \`${id}\` | ${delta.construction[id] ?? 0} | ${delta.research[id] ?? 0} | ${delta.total[id]} |`,
    );
  lines.push(
    '',
    'Numbers above are expected material equivalents; use `--whole-crafts` for pooled batch rounding.',
    'Required research is the union of the stated goals, ingredients and selected crafting machines, after removing the baseline closure.',
    'Extra production machinery is listed by the query tool but has no invented quantities or capital cost.',
    '',
  );
  await writeFile(`${DIR}/k2-catalogue.md`, lines.join('\n'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--refresh')) {
    if (args.length !== 1 || !process.env.APP)
      throw new Error('Usage: APP=~/ins/factorio/2.1.21 node scripts/k2-milestones.ts --refresh');
    const blueprints = await Promise.all(
      ['m1', 'm2'].map(async (id) =>
        decode(await readFile(`docs/blueprints/${id}.base64`, 'utf8')),
      ),
    );
    const recipes = [
      ...new Set(
        blueprints.flatMap((b) => (b.entities ?? []).flatMap((e) => (e.recipe ? [e.recipe] : []))),
      ),
    ];
    const data = await extract(resolve(process.env.APP), recipes);
    await mkdir(DIR, { recursive: true });
    await writeFile(DATA, JSON.stringify(data, null, 2) + '\n');
    await writeReports(data);
    console.log(`Wrote ${DATA}, k2-costs.json and k2-catalogue.md`);
    return;
  }
  const data = JSON.parse(await readFile(DATA, 'utf8')) as MilestoneData;
  if (args.length === 1 && args[0] === '--write') {
    await writeReports(data);
    return;
  }
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (
    positional.length !== 2 ||
    args.some((arg) => arg.startsWith('--') && !['--raw', '--whole-crafts'].includes(arg))
  ) {
    throw new Error(
      'Usage: node scripts/k2-milestones.ts FROM TO [--raw] [--whole-crafts]\nFROM/TO: empty, m1, m2, all-red-green, chemical-ready, tech:ID[,ID], item:ID, milestone.json, or blueprint.base64\nUse --write to regenerate reports from the snapshot; --refresh with APP to re-extract.',
    );
  }
  const [from, to] = await Promise.all(positional.map((name) => loadMilestone(data, name)));
  console.log(
    JSON.stringify(
      compare(
        data,
        from,
        to,
        data.boundaries[args.includes('--raw') ? 'raw' : 'plates'],
        args.includes('--whole-crafts'),
      ),
      null,
      2,
    ),
  );
}

if (import.meta.main) await main();
