/**
 * Community Vouching and Society Verification Rules (F26).
 *
 * Rules:
 *   - >= 3 vouches required to achieve quorum.
 *   - >= 2/3 (66.7%) of non-abstaining voters must vouch.
 *   - 7-day voting window.
 *   - Collusion safeguard: any "concern" vote routes to an admin/society
 *     investigation ("referred") instead of auto-rejecting or auto-passing.
 */

export interface VouchEntry {
  choice: 'vouch' | 'concern' | 'abstain';
  createdAt: Date;
}

export interface VouchEvaluation {
  status: 'open' | 'passed' | 'rejected' | 'referred';
  vouchCount: number;
  concernCount: number;
  abstainCount: number;
  totalVoters: number;
  reason: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function evaluateVouchOutcome(
  vouches: VouchEntry[],
  openedAt: Date,
  now = new Date(),
): VouchEvaluation {
  let vouchCount = 0;
  let concernCount = 0;
  let abstainCount = 0;

  for (const v of vouches) {
    if (v.choice === 'vouch') vouchCount++;
    else if (v.choice === 'concern') concernCount++;
    else if (v.choice === 'abstain') abstainCount++;
  }

  const totalVoters = vouches.length;
  const nonAbstain = vouchCount + concernCount;
  const isExpired = now.getTime() - openedAt.getTime() >= SEVEN_DAYS_MS;

  // Safeguard: Any concern automatically refers the candidate to society admin review
  if (concernCount > 0) {
    return {
      status: 'referred',
      vouchCount,
      concernCount,
      abstainCount,
      totalVoters,
      reason: `Flagged for manual society review: ${concernCount} neighbour(s) raised safety concern(s).`,
    };
  }

  // Quorum check: requires at least 3 vouches
  if (vouchCount >= 3) {
    const approvalRatio = nonAbstain > 0 ? vouchCount / nonAbstain : 0;
    if (approvalRatio >= 2 / 3) {
      return {
        status: 'passed',
        vouchCount,
        concernCount,
        abstainCount,
        totalVoters,
        reason: `Community verified: ${vouchCount} verified neighbours approved with 0 concerns.`,
      };
    }
  }

  // If window expired and didn't meet quorum
  if (isExpired) {
    return {
      status: 'rejected',
      vouchCount,
      concernCount,
      abstainCount,
      totalVoters,
      reason: `Voting deadline expired after 7 days without meeting the 3-vouch quorum (${vouchCount}/3 vouches).`,
    };
  }

  // Still active
  return {
    status: 'open',
    vouchCount,
    concernCount,
    abstainCount,
    totalVoters,
    reason: `Voting in progress: ${vouchCount}/3 required vouches received.`,
  };
}
