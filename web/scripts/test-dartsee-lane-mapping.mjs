import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/dartsee-board-map.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const mapping = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const legacyOrder = [
  "beavercreek01",
  "beavercreek02",
  "beavercreek02b",
  "beavercreek03",
  "beavercreek05",
];
const physicalOrder = [
  "beavercreek01",
  "beavercreek02",
  "beavercreek03",
  "beavercreek02b",
  "beavercreek05",
];

assert.deepEqual(
  mapping.normalizeDartseeBoardIds(legacyOrder),
  physicalOrder,
  "Legacy production configuration must be normalized to the physical lane order",
);
assert.equal(mapping.normalizeDartseeBoardIds(legacyOrder)[2], "beavercreek03");
assert.equal(mapping.normalizeDartseeBoardIds(legacyOrder)[3], "beavercreek02b");
assert.deepEqual(
  mapping.normalizeDartseeBoardIds(["future-a", "future-b"]),
  ["future-a", "future-b"],
  "An unknown future venue configuration must retain its explicit order",
);

const oldSnapshotLanes = legacyOrder.map((boardId, index) => ({
  lane: index + 1,
  boardId,
  name: boardId,
  status: "open",
}));
const rebased = mapping.normalizeDartseeLaneIdentities(
  oldSnapshotLanes,
  legacyOrder,
);
assert.deepEqual(
  rebased.map(({ lane, boardId }) => ({ lane, boardId })),
  physicalOrder.map((boardId, index) => ({ lane: index + 1, boardId })),
  "Last-known-good snapshots must be rebased before staff cards or controls use them",
);

const dartseeSource = readFileSync(
  new URL("../src/lib/dartsee-lanes.ts", import.meta.url),
  "utf8",
);
assert.match(
  dartseeSource,
  /function boardIds\(\): string\[\][\s\S]*?return normalizeDartseeBoardIds/,
  "Live reads must use the normalized physical order",
);
assert.match(
  dartseeSource,
  /export function dartseeBoardIdForLane[\s\S]*?const ids = boardIds\(\);[\s\S]*?return ids\[lane - 1\]/,
  "Start, End, and Override controls must use the same normalized order",
);
assert.match(
  dartseeSource,
  /lanes: normalizeDartseeLaneIdentities\(parsed\.lanes, boardIds\(\)\)/,
  "Stored snapshots must be rebased to the same control mapping",
);

console.log("Dartsee physical lane mapping regression test passed.");
