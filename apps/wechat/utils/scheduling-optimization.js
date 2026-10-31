const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function parse(value, revision) {
  const invalid = () => {
    throw new Error('优化预览与当前草稿不一致，请重新读取');
  };
  if (
    !value ||
    value.algorithm !== 'BALANCED_SEARCH_V1' ||
    value.optimality !== 'BOUNDED_HEURISTIC' ||
    value.eventVersion !== revision.eventVersion ||
    value.revisionVersion !== revision.version ||
    !['COMPLETE', 'PARTIAL', 'LIMIT_REACHED'].includes(value.status) ||
    !Array.isArray(value.allocations) ||
    value.allocations.length !== revision.fixtures.length ||
    !Array.isArray(value.unassigned) ||
    !Number.isSafeInteger(value.checks) ||
    value.checks < 0 ||
    value.checks > 100000 ||
    typeof value.limitReached !== 'boolean' ||
    !/^[0-9a-f]{64}$/.test(value.sourceHash || '') ||
    !value.score ||
    !Number.isSafeInteger(value.score.firstLastPenalty) ||
    value.score.firstLastPenalty < 0
  )
    invalid();
  const keys = new Set(revision.fixtures.map((f) => f.fixtureKey)),
    seen = new Set();
  const allocations = value.allocations.map((a) => {
    if (!a || !keys.has(a.fixtureKey) || seen.has(a.fixtureKey)) invalid();
    seen.add(a.fixtureKey);
    if (a.courtId === null && a.startsAt === null)
      return { fixtureKey: a.fixtureKey, courtId: null, startsAt: null };
    if (
      !uuid.test(a.courtId || '') ||
      typeof a.startsAt !== 'string' ||
      !Number.isFinite(Date.parse(a.startsAt))
    )
      invalid();
    return { fixtureKey: a.fixtureKey, courtId: a.courtId, startsAt: a.startsAt };
  });
  const unassigned = allocations.filter((a) => !a.startsAt).length;
  if (
    unassigned !== value.unassigned.length ||
    (value.status === 'COMPLETE') !== (unassigned === 0) ||
    value.score.assignedCount !== allocations.length - unassigned
  )
    invalid();
  return {
    allocations,
    unassigned,
    checks: value.checks,
    limitReached: value.limitReached,
    penalty: value.score.firstLastPenalty,
  };
}
module.exports = { parse };
