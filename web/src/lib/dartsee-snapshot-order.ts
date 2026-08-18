export interface DartseeSnapshotVersion {
  capturedAt: string;
  stateVersionAt?: string;
  receivedAt: string;
}

export function dartseeSnapshotStateVersionMs(
  snapshot: DartseeSnapshotVersion,
): number {
  const explicit = snapshot.stateVersionAt
    ? new Date(snapshot.stateVersionAt).getTime()
    : Number.NaN;
  if (Number.isFinite(explicit)) return explicit;
  const captured = new Date(snapshot.capturedAt).getTime();
  return Number.isFinite(captured) ? captured : Number.NEGATIVE_INFINITY;
}

export function dartseeSnapshotReceivedVersionMs(
  snapshot: DartseeSnapshotVersion,
): number {
  const received = new Date(snapshot.receivedAt).getTime();
  return Number.isFinite(received)
    ? received
    : dartseeSnapshotStateVersionMs(snapshot);
}

export function compareDartseeSnapshotVersions(
  left: DartseeSnapshotVersion,
  right: DartseeSnapshotVersion,
): number {
  const stateDifference =
    dartseeSnapshotStateVersionMs(left) -
    dartseeSnapshotStateVersionMs(right);
  if (stateDifference !== 0) return stateDifference;
  return (
    dartseeSnapshotReceivedVersionMs(left) -
    dartseeSnapshotReceivedVersionMs(right)
  );
}

export function dartseeSnapshotStorageObjectName(
  snapshot: DartseeSnapshotVersion,
  uniqueSuffix: string,
): string {
  const stateVersion = Math.max(0, dartseeSnapshotStateVersionMs(snapshot));
  const receivedVersion = Math.max(
    0,
    dartseeSnapshotReceivedVersionMs(snapshot),
  );
  return `${String(stateVersion).padStart(13, "0")}-${String(receivedVersion).padStart(13, "0")}-${uniqueSuffix}.json`;
}

export function newerDartseeSnapshot<T extends DartseeSnapshotVersion>(
  left: T,
  right: T,
): T {
  return compareDartseeSnapshotVersions(left, right) >= 0 ? left : right;
}
