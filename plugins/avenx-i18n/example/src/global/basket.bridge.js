import { bridge } from 'avenx-core/runtime';

/**
 * The basket.
 *
 * An ordinary Avenx bridge with no knowledge of i18n at all — which is the
 * point. Translation is a rendering concern: the bridge counts items and
 * totals prices, and the component decides how to say that in the visitor's
 * language.
 */
export default bridge({
  state: {
    items: 2,
    unitPrice: 24.5,
    placedAt: Date.now() - 1000 * 60 * 60 * 26,
  },

  /**
   * @returns {number} What the basket costs.
   */
  get total() {
    return this.items * this.unitPrice;
  },

  /**
   * @returns {number} Whole days since the order was placed. Negative, which
   *   is the direction Intl.RelativeTimeFormat expects for the past.
   */
  get placedDaysAgo() {
    return -Math.floor((Date.now() - this.placedAt) / (1000 * 60 * 60 * 24));
  },

  /**
   * Adds one item.
   */
  add() {
    this.items++;
  },

  /**
   * Removes one item, never going below empty.
   */
  remove() {
    this.items = Math.max(0, this.items - 1);
  },
});
