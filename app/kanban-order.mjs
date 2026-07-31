/**
 * Reorders cards inside one column while keeping their order values contiguous.
 * A null target means the card was dropped on the column itself and moves it
 * to the end.
 *
 * @template {{ id: number, order: number }} T
 * @param {T[]} cards
 * @param {number} activeId
 * @param {number | null} overId
 * @returns {T[]}
 */
export function reorderCardsWithinColumn(cards, activeId, overId) {
  const fromIndex = cards.findIndex((card) => card.id === activeId);
  const toIndex =
    overId === null
      ? cards.length - 1
      : cards.findIndex((card) => card.id === overId);

  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return cards;

  const next = [...cards];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((card, order) => ({ ...card, order }));
}
