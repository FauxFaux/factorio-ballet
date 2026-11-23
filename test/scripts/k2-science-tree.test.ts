import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scienceTree } from '../../scripts/k2-science-tree.ts';
import { closure } from '../../scripts/milestones/model.ts';
import type { MilestoneData } from '../../scripts/milestones/model.ts';

const data = JSON.parse(readFileSync('docs/milestones/k2-data.json', 'utf8')) as MilestoneData;
const tree = scienceTree(data);

describe('K2 early science tree', () => {
  it('exports both pack unlocks and all optional early branches with complete dependencies', () => {
    expect(Object.keys(tree.technologies)).toHaveLength(91);
    for (const id of [...tree.scope.endpoints, 'kr-light-armor', 'bulk-inserter']) {
      expect(tree.technologies).toHaveProperty(id);
    }
    expect(tree.technologies).not.toHaveProperty('logistic-robotics');
    expect(tree.technologies).not.toHaveProperty('advanced-material-processing-2');
    expect(tree.technologies).not.toHaveProperty('flamethrower');
    for (const [id, technology] of Object.entries(tree.technologies)) {
      expect(technology.name).toBe(data.technologies[id].human);
      expect(technology.dependencies).toEqual(data.technologies[id].prerequisites);
      expect(technology.cost).toEqual(data.technologies[id].science);
      for (const dependency of closure(data, [id])) {
        expect(tree.technologies).toHaveProperty(dependency);
      }
      expect(Object.keys(technology.cost).every((p) => tree.scope.researchPacks.includes(p))).toBe(
        true,
      );
    }
    expect(tree.technologies.logistics).toEqual({
      name: 'Logistics',
      dependencies: ['automation-science-pack'],
      cost: { 'kr-basic-tech-card': 20, 'automation-science-pack': 20 },
      researchTime: { units: 20, secondsPerUnit: 15, totalSeconds: 300 },
    });
    expect(tree.technologies['oil-processing']).toMatchObject({
      cost: {},
      researchTime: null,
      trigger: { type: 'mine-entity', entities: ['crude-oil'] },
    });
  });

  it('counts research units once when a unit consumes multiple cards', () => {
    const modified = structuredClone(data);
    modified.technologies.logistics.science = {
      'kr-basic-tech-card': 40,
      'automation-science-pack': 60,
    };
    expect(scienceTree(modified).technologies.logistics.researchTime).toEqual({
      units: 20,
      secondsPerUnit: 15,
      totalSeconds: 300,
    });
    for (const [id, technology] of Object.entries(tree.technologies)) {
      const unit = data.technologies[id].researchUnit;
      if (data.technologies[id].trigger) {
        expect(technology.researchTime).toBeNull();
      } else {
        expect(unit?.count).toBeGreaterThan(0);
        expect(unit?.time).toBeGreaterThan(0);
        expect(technology.researchTime?.totalSeconds).toBe(unit!.count! * unit!.time);
      }
    }
  });

  it('preserves research milestone goals, parenthesized requirements and banned choices', () => {
    expect(tree.milestones[1]).toEqual({ milestone: 2, goals: ['logistics'], requirements: [] });
    expect(tree.milestones[0].requirements).toEqual(['kr-laboratory']);
    expect(tree.milestones[3]).toEqual({
      milestone: 4,
      goals: ['kr-greenhouse'],
      requirements: ['kr-crusher', 'kr-stone-processing'],
    });
    expect(tree.milestones).toHaveLength(9);
    expect(tree.milestones[7].goals).toEqual(['chemical-science-pack']);
    expect(tree.milestones.at(-1)).toEqual({
      milestone: 9,
      goals: ['construction-robotics'],
      requirements: [
        'advanced-oil-processing',
        'lubricant',
        'electric-engine',
        'battery',
        'robotics',
      ],
    });
    expect(data.technologies.robotics.unlocks).toContain('flying-robot-frame');
    expect(tree.technologies['construction-robotics']).toEqual({
      name: 'Construction robotics',
      dependencies: ['robotics'],
      cost: {
        'automation-science-pack': 100,
        'logistic-science-pack': 100,
        'chemical-science-pack': 100,
      },
      researchTime: { units: 100, secondsPerUnit: 30, totalSeconds: 3000 },
    });
    for (const { goals, requirements } of tree.milestones) {
      for (const id of [...goals, ...requirements]) {
        expect(tree.technologies).toHaveProperty(id);
      }
    }
    expect(tree.banned.map((id) => tree.technologies[id].name)).toEqual([
      'Welcome to the jungle',
      'Shelter',
    ]);
  });

  it('keeps the committed export reproducible from the portable snapshot', () => {
    expect(JSON.parse(readFileSync('docs/milestones/k2-science-tree.json', 'utf8'))).toEqual(tree);
  });
});
