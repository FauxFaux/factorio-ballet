#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { allRedGreen } from './k2-milestones.ts';
import { closure } from './milestones/model.ts';
import type { MilestoneData } from './milestones/model.ts';

const OUTPUT = 'docs/milestones/k2-science-tree.json';

// Research goals in TEST-PLAY.md: parentheses distinguish requirements from milestone goals.
const MILESTONES = [
  {
    milestone: 1,
    goals: ['automation', 'military', 'steam-power', 'automation-science-pack'],
    requirements: ['kr-laboratory'],
  },
  { milestone: 2, goals: ['logistics'], requirements: [] },
  { milestone: 3, goals: ['gun-turret', 'electric-mining-drill'], requirements: [] },
  {
    milestone: 4,
    goals: ['kr-greenhouse'],
    requirements: ['kr-crusher', 'kr-stone-processing'],
  },
  { milestone: 5, goals: ['electronics', 'logistic-science-pack'], requirements: [] },
  {
    milestone: 6,
    goals: ['oil-processing'],
    requirements: [
      'steel-processing',
      'fluid-handling',
      'engine',
      'oil-gathering',
      'kr-fluids-chemistry',
    ],
  },
  { milestone: 7, goals: ['plastics', 'sulfur-processing'], requirements: [] },
  {
    milestone: 8,
    goals: ['chemical-science-pack'],
    requirements: ['automation-2', 'kr-silicon-processing', 'advanced-circuit'],
  },
  {
    milestone: 9,
    goals: ['construction-robotics'],
    requirements: [
      'advanced-oil-processing',
      'lubricant',
      'electric-engine',
      'battery',
      'robotics',
    ],
  },
];

export function scienceTree(data: MilestoneData) {
  // Include optional branches too, without the complexity model's distorted military weighting.
  const ids = closure(data, [
    ...allRedGreen(data).sort(),
    ...MILESTONES.flatMap(({ goals, requirements }) => [...goals, ...requirements]),
  ]);
  const included = new Set(ids);
  for (const milestone of MILESTONES) {
    for (const id of [...milestone.goals, ...milestone.requirements]) {
      if (!included.has(id)) throw new Error(`Milestone technology outside early tree: ${id}`);
    }
  }
  return {
    provenance: { ...data.provenance, source: 'docs/milestones/k2-data.json' },
    scope: {
      description:
        'All finite basic/automation/logistic technologies, including optional branches and chemical/military card unlocks, plus the complete prerequisite branch for the nine research milestones through construction robotics.',
      researchPacks: [
        'kr-basic-tech-card',
        'automation-science-pack',
        'logistic-science-pack',
        'chemical-science-pack',
      ],
      endpoints: ['chemical-science-pack', 'military-science-pack', 'construction-robotics'],
      costUnits:
        'Total tech cards consumed by this technology alone, excluding prerequisites; trigger research has no card cost and retains its trigger.',
      researchTimeUnits:
        'Seconds per research unit and total lab-seconds at research speed 1, before lab speed or productivity bonuses and excluding prerequisites; trigger research has null time.',
    },
    milestones: MILESTONES,
    banned: ['kr-decorations', 'kr-shelter'],
    technologies: Object.fromEntries(
      ids.map((id) => {
        const technology = data.technologies[id];
        const unit = technology.researchUnit;
        if (!technology.trigger && unit?.count === undefined) {
          throw new Error(`Missing finite research units for ${id}; refresh the K2 snapshot`);
        }
        return [
          id,
          {
            name: technology.human,
            dependencies: technology.prerequisites,
            cost: technology.science,
            researchTime:
              unit?.count !== undefined
                ? {
                    units: unit.count,
                    secondsPerUnit: unit.time,
                    totalSeconds: unit.count * unit.time,
                  }
                : null,
            ...(technology.trigger ? { trigger: technology.trigger } : {}),
          },
        ];
      }),
    ),
  };
}

if (import.meta.main) {
  const data = JSON.parse(await readFile('docs/milestones/k2-data.json', 'utf8')) as MilestoneData;
  await writeFile(OUTPUT, JSON.stringify(scienceTree(data), null, 2) + '\n');
  console.log(`Wrote ${OUTPUT}`);
}
