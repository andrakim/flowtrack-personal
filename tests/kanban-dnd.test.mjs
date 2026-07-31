import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reorderCardsWithinColumn } from "../app/kanban-order.mjs";

const appUrl = new URL("../app/flowtrack-app.tsx", import.meta.url);

test("reorders kanban cards correctly in both directions", () => {
  const cards = [
    { id: 1, order: 0 },
    { id: 2, order: 1 },
    { id: 3, order: 2 },
  ];

  assert.deepEqual(
    reorderCardsWithinColumn(cards, 2, 3).map((card) => card.id),
    [1, 3, 2],
  );
  assert.deepEqual(
    reorderCardsWithinColumn(cards, 1, 3).map((card) => card.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    reorderCardsWithinColumn(cards, 3, 1).map((card) => card.id),
    [3, 1, 2],
  );
  assert.deepEqual(
    reorderCardsWithinColumn(cards, 1, null).map((card) => card.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    reorderCardsWithinColumn(cards, 2, 3).map((card) => card.order),
    [0, 1, 2],
  );
});

test("keeps the drag preview at the original grab offset", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /createPortal\([\s\S]*?<DragOverlay/);
  assert.match(source, /dropAnimation=\{null\}/);
  assert.doesNotMatch(source, /alignDragOverlayWithCursor/);
  assert.doesNotMatch(source, /modifiers=\{\[alignDragOverlayWithCursor\]\}/);
});
