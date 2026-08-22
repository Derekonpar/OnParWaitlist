export const DEFAULT_DARTSEE_BOARD_IDS = [
  "beavercreek01",
  "beavercreek02",
  "beavercreek03",
  "beavercreek02b",
  "beavercreek05",
] as const;

/**
 * Older installs listed the third and fourth physical boards in the opposite
 * order. When the configured IDs are the known Beavercreek set, normalize
 * them to the verified venue-facing lane order. Unknown future configurations
 * retain their explicit order.
 */
export function normalizeDartseeBoardIds(
  configured?: readonly string[],
): string[] {
  const ids = (configured ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (!ids.length) return [...DEFAULT_DARTSEE_BOARD_IDS];

  const unique = new Set(ids);
  const isKnownBeavercreekSet =
    ids.length === DEFAULT_DARTSEE_BOARD_IDS.length &&
    unique.size === DEFAULT_DARTSEE_BOARD_IDS.length &&
    DEFAULT_DARTSEE_BOARD_IDS.every((id) => unique.has(id));

  return isKnownBeavercreekSet ? [...DEFAULT_DARTSEE_BOARD_IDS] : ids;
}

export function normalizeDartseeLaneIdentities<
  T extends { boardId: string; lane: number; name: string },
>(lanes: readonly T[], configured?: readonly string[]): T[] {
  const ids = normalizeDartseeBoardIds(configured);
  if (ids.length !== 5 || new Set(ids).size !== 5) return [...lanes];

  const laneByBoard = new Map(ids.map((boardId, index) => [boardId, index + 1]));
  return lanes
    .map((lane) => {
      const displayLane = laneByBoard.get(lane.boardId);
      return displayLane
        ? { ...lane, lane: displayLane, name: lane.boardId }
        : lane;
    })
    .sort((left, right) => left.lane - right.lane);
}
