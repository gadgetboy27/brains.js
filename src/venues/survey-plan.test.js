import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findPlanRow, floorsFromPlan, parseFloorLabel, parseSurveyPlan } from './survey-plan.js';

const template = readFileSync(
  resolve(process.cwd(), 'src/venues/templates/demo-hospital-survey-plan.txt'),
  'utf8'
);

describe('survey plan', () => {
  it('parses floor labels', () => {
    expect(parseFloorLabel('G')).toBe(0);
    expect(parseFloorLabel('ground')).toBe(0);
    expect(parseFloorLabel('1')).toBe(1);
    expect(parseFloorLabel('L2')).toBe(2);
    expect(parseFloorLabel('Level 3')).toBe(3);
    expect(parseFloorLabel('B')).toBe(-1);
    expect(parseFloorLabel('B2')).toBe(-2);
    expect(parseFloorLabel('M')).toBeNull();
  });

  it('parses the demo hospital plan: 24 codes over three floors', () => {
    const { rows, errors } = parseSurveyPlan(template);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(24);
    expect(rows[2]).toEqual({ code: 'A03', floor: 0, floorLabel: 'G', name: 'Reception desk' });
    expect(rows[17]).toEqual({ code: 'A18', floor: 1, floorLabel: '1', name: 'Ward 1 entrance' });
    expect(floorsFromPlan(rows)).toEqual([
      { index: 0, id: 'ground', name: 'Ground', elevation: 0 },
      { index: 1, id: 'l1', name: 'Level 1', elevation: 4 },
      { index: 2, id: 'l2', name: 'Level 2', elevation: 8 },
    ]);
  });

  it('reports bad lines without losing good ones', () => {
    const { rows, errors } = parseSurveyPlan(
      'A01, G, Entrance\nA02\nA03, M, Mezz\nA01, G, Dup\nA04\tB1\tBasement door'
    );
    expect(rows.map((r) => r.code)).toEqual(['A01', 'A04']);
    expect(errors).toEqual([
      'line 2: expected "code, floor, where"',
      'line 3: unknown floor "M" (use G, B, or a number)',
      'line 4: code A01 listed twice',
    ]);
    expect(rows[1].floor).toBe(-1);
  });

  it('finds a row by exact code or by a code embedded in a printed URL', () => {
    const { rows } = parseSurveyPlan(template);
    expect(findPlanRow(rows, 'A09').name).toBe('Radiology reception');
    expect(findPlanRow(rows, 'https://stickers.example/A09?x=1').name).toBe('Radiology reception');
    expect(findPlanRow(rows, 'A1')).toBeNull(); // not A10..A19
    expect(findPlanRow(rows, 'ZZ')).toBeNull();
  });
});
