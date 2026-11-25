import { describe, it, expect } from 'vitest';
import {
  personalPlanOf,
  workspaceLabel,
  workspaceOf
} from '@shared/utils/workspace.js';

const team = (extra = {}) => ({
  orgId: 'uo',
  name: 'UO Urban Design 410',
  plan: 'PRO',
  role: 'member',
  status: 'active',
  ...extra
});

describe('workspaceOf', () => {
  it("is the active team and its plan, even when the user's own plan is higher", () => {
    const user = { plan: 'MAX', orgs: [team()], activeOrgId: 'uo' };
    expect(workspaceOf(user)).toEqual({ team: team(), plan: 'PRO' });
  });

  it("is Personal with the user's own plan otherwise", () => {
    expect(
      workspaceOf({ plan: 'MAX', orgs: [team()], activeOrgId: null })
    ).toEqual({ team: null, plan: 'MAX' });
  });

  it('is a suspended active team, without its plan', () => {
    const user = {
      plan: 'MAX',
      orgs: [team({ status: 'suspended' })],
      activeOrgId: 'uo'
    };
    expect(workspaceOf(user)).toEqual({
      team: team({ status: 'suspended' }),
      plan: null
    });
    expect(workspaceLabel(user)).toBe('INACTIVE · UO Urban Design 410');
  });
});

describe('personalPlanOf', () => {
  it('ignores team seats but keeps a domain team, a pass and a subscription', () => {
    expect(personalPlanOf({ plan: 'PRO' })).toBe('PRO');
    expect(personalPlanOf({ isProPass: true })).toBe('PRO');
    expect(personalPlanOf({ isProTeam: true, teamDomain: 'uo.edu' })).toBe(
      'PRO TEAM'
    );
    expect(
      personalPlanOf({ isProTeam: true, teamName: 'LA Metro', orgPlan: 'MAX' })
    ).toBe(null);
    expect(personalPlanOf(null)).toBe(null);
  });
});

describe('workspaceLabel', () => {
  it('names the team and its plan, or the own plan under Personal', () => {
    expect(workspaceLabel({ orgs: [team()], activeOrgId: 'uo' })).toBe(
      'PRO · UO Urban Design 410'
    );
    expect(workspaceLabel({ plan: 'MAX', orgs: [team()] })).toBe('MAX');
    expect(workspaceLabel({ orgs: [] })).toBe('FREE');
  });
});
