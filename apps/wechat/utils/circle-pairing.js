function circlePairings(orderedEntryIds) {
  if (
    !Array.isArray(orderedEntryIds) ||
    orderedEntryIds.length < 2 ||
    orderedEntryIds.length > 32 ||
    new Set(orderedEntryIds).size !== orderedEntryIds.length
  )
    throw new Error('参赛方需为2–32个且不能重复');
  let rotation = orderedEntryIds.slice();
  if (rotation.length % 2) rotation.push(null);
  const rounds = [];
  const fixtures = [];
  for (let roundNo = 1; roundNo < rotation.length; roundNo += 1) {
    let byeEntryId = null;
    for (let positionNo = 1; positionNo <= rotation.length / 2; positionNo += 1) {
      const homeEntryId = rotation[positionNo - 1];
      const awayEntryId = rotation[rotation.length - positionNo];
      if (homeEntryId === null || awayEntryId === null) {
        byeEntryId = homeEntryId ?? awayEntryId;
        continue;
      }
      fixtures.push({
        fixtureKey: 'R' + roundNo + '-P' + positionNo,
        roundNo,
        positionNo,
        homeEntryId,
        awayEntryId,
        courtId: null,
        startsAt: null,
        endsAt: null,
      });
    }
    rounds.push({ roundNo, byeEntryId });
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }
  return { rounds, fixtures };
}

module.exports = { circlePairings };
