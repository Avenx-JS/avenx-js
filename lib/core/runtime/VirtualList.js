import { AvenxComponent } from './AvenxComponent.js';
import { TemplateRenderer } from '../renderer/renderTemplate.js';
import { DomPatcher } from '../renderer/domPatch.js';

/**
 * Built-in component for high-performance virtualized list rendering.
 * Only renders items currently visible within the viewport.
 */
export class VirtualList extends AvenxComponent {
  /**
   * @param {object} [bridges] - External bridges.
   * @param {object} [props] - Component properties (items, itemHeight).
   */
  constructor(bridges, props = {}) {
    super(
      {},
      {},
      bridges,
      `
      <div class="virtual-list-viewport" data-ax-ref="viewport" style="overflow-y: auto; position: relative; height: 100%; width: 100%;">
        <div class="virtual-list-spacer" data-ax-ref="spacer" data-ax-static style="box-sizing: border-box; width: 100%;">
          <!-- Recycled item DOM elements will be injected here -->
        </div>
      </div>
      `,
      {},
      props
    );

    /** @type {number[]} Measured actual heights of individual items */
    this.measuredHeights = [];
    /** @type {HTMLTemplateElement|null} The template node extracted from slot transclusion */
    this.templateNode = null;
    /** @type {string} Loop item variable name (e.g. 'item') */
    this.itemVar = 'item';
    /** @type {ResizeObserver|null} Resize observer to monitor dynamic item size changes */
    this.resizeObserver = null;

    this.renderer = new TemplateRenderer();
    this.patcher = new DomPatcher();

    this.onScroll = this.onScroll.bind(this);
  }

  /**
   * Lifecycle hook called after component is mounted.
   * Sets up transcluded template slots and scroll listeners.
   */
  onMount() {
    const transcluded = this._getTranscludedGroups();
    const defaultNodes = (transcluded && transcluded.default) || [];

    // Extract template slot node from transcluded default contents
    const templateEl = defaultNodes.find(
      (node) => node.nodeType === 1 && node.tagName.toLowerCase() === 'template'
    );

    if (templateEl) {
      this.templateNode = templateEl;
      this.itemVar = templateEl.getAttribute('data-ax-as') || 'item';
    } else {
      // Fallback: If no template is provided, use the first element node as row template
      const itemEl = defaultNodes.find((node) => node.nodeType === 1);
      if (itemEl) {
        const temp = document.createElement('template');
        temp.appendChild(itemEl.cloneNode(true));
        this.templateNode = temp;
      }
    }

    if (this.$refs.viewport) {
      this.$refs.viewport.addEventListener('scroll', this.onScroll);
    }

    if (this.$refs.spacer) {
      this.$refs.spacer.innerHTML = '';
    }
    this.measuredHeights = [];
    this.layout();
  }

  /**
   * Lifecycle hook called after component updates.
   * Re-evaluates virtualization layouts when properties (e.g. items) change.
   */
  onUpdate() {
    this.layout();
  }

  /**
   * Lifecycle hook called when component unmounts.
   * Clean up event listeners and observers to prevent leaks.
   */
  onUnmount() {
    if (this.$refs.viewport) {
      this.$refs.viewport.removeEventListener('scroll', this.onScroll);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Viewport scroll event handler.
   */
  onScroll() {
    this.layout();
  }

  /**
   * Creates a fresh element structure from the template to populate recycled element pool.
   * @returns {Element}
   */
  createItemElement() {
    const templateHTML = this.templateNode.innerHTML.replace(/{%/g, '{{').replace(/%}/g, '}}');
    const tempDiv = document.createElement('div');
    const html = this.renderer.render(templateHTML, () => '').trim();
    tempDiv.innerHTML = html;
    let element = tempDiv.firstElementChild || document.createElement('div');
    element = this.patcher.cleanElement(element);
    return element;
  }

  /**
   * Measures visible DOM nodes and updates layout variables (e.g., offsets/heights/scrollbars).
   */
  layout() {
    if (!this.templateNode) return;

    const items = this.props.items || [];
    const defaultHeight = Number(this.props.itemHeight || this.props['item-height']) || 40;
    const viewport = this.$refs.viewport;
    const spacer = this.$refs.spacer;
    if (!viewport || !spacer) return;

    const viewportHeight = viewport.clientHeight || 400;
    const scrollTop = viewport.scrollTop;

    // 1. Calculate heights array
    const heights = [];
    for (let i = 0; i < items.length; i++) {
      heights.push(this.measuredHeights[i] !== undefined ? this.measuredHeights[i] : defaultHeight);
    }

    // 2. Cumulative heights for fast offset/index resolution
    const cumHeights = [0];
    for (let i = 0; i < items.length; i++) {
      cumHeights.push(cumHeights[i] + heights[i]);
    }
    const totalHeight = cumHeights[items.length];

    // 3. Find visible item range with buffer
    const buffer = 5;
    let startIndex = 0;
    while (startIndex < items.length && cumHeights[startIndex + 1] <= scrollTop) {
      startIndex++;
    }
    startIndex = Math.max(0, startIndex - buffer);

    let endIndex = startIndex;
    while (endIndex < items.length && cumHeights[endIndex] < scrollTop + viewportHeight) {
      endIndex++;
    }
    endIndex = Math.min(items.length, endIndex + buffer);

    const visibleCount = endIndex - startIndex;

    // 4. Update spacer paddings and min-height
    const paddingTop = cumHeights[startIndex];
    const paddingBottom = totalHeight - cumHeights[endIndex];

    spacer.style.paddingTop = `${paddingTop}px`;
    spacer.style.paddingBottom = `${paddingBottom}px`;
    spacer.style.minHeight = `${totalHeight}px`;

    // 5. Sync spacer's child node count with visibleCount to manage recycled elements pool
    while (spacer.childNodes.length > visibleCount) {
      const lastChild = spacer.lastChild;
      if (this.resizeObserver && lastChild.nodeType === 1) {
        this.resizeObserver.unobserve(lastChild);
      }
      spacer.removeChild(lastChild);
    }

    while (spacer.childNodes.length < visibleCount) {
      const itemEl = this.createItemElement();
      spacer.appendChild(itemEl);
    }

    // 6. Lazy-initialize ResizeObserver
    if (!this.resizeObserver && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        let sizeChanged = false;
        for (const entry of entries) {
          const indexAttr = entry.target.getAttribute('data-index');
          if (indexAttr === null) continue;
          const idx = parseInt(indexAttr, 10);
          const newHeight = entry.target.offsetHeight;
          if (newHeight && newHeight !== this.measuredHeights[idx]) {
            this.measuredHeights[idx] = newHeight;
            sizeChanged = true;
          }
        }
        if (sizeChanged) {
          requestAnimationFrame(() => this.layout());
        }
      });
    }

    // 7. Dynamic patching and recycling of row elements
    const templateHTML = this.templateNode.innerHTML.replace(/{%/g, '{{').replace(/%}/g, '}}');

    for (let i = 0; i < visibleCount; i++) {
      const itemIndex = startIndex + i;
      const item = items[itemIndex];
      const domNode = spacer.childNodes[i];

      domNode.setAttribute('data-index', String(itemIndex));

      if (this.resizeObserver && domNode.nodeType === 1) {
        this.resizeObserver.observe(domNode);
      }

      // Resolver using parent context or component scope
      const resolver = (expr) => {
        const extraScope = {
          [this.itemVar]: item,
          index: itemIndex,
        };
        return this.$parent ? this.$parent._evaluate(expr, extraScope) : this._evaluate(expr, extraScope);
      };

      const renderedHTML = this.renderer.render(templateHTML, resolver).trim();
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = renderedHTML;
      let newElement = tempDiv.firstElementChild;
      if (newElement) {
        newElement = this.patcher.cleanElement(newElement);
        newElement.setAttribute('data-index', String(itemIndex));

        this.patcher.patchElement(domNode, newElement, resolver);
      }
    }
  }
}
