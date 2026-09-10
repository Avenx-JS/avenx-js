import { AvenxComponent } from './AvenxComponent.js';
import { TemplateRenderer } from '../renderer/renderTemplate.js';
import { DomPatcher } from '../renderer/domPatch.js';
import { unescapeTemplateMarkers } from '../utils/templateUtils.js';

/**
 * Built-in component for high-performance virtualized list rendering.
 * Only renders items currently visible within the viewport.
 * Supports optional pagination mode with pageSize, current page tracking, and navigation controls.
 */
export class VirtualList extends AvenxComponent {
  /**
   * @param {object} [bridges] - External bridges.
   * @param {object} [props] - Component properties (items, itemHeight, pageSize, page, totalItems, showControls).
   */
  constructor(bridges, props = {}) {
    super(
      {},
      {},
      bridges,
      `
      <div class="virtual-list-container" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
        <div class="virtual-list-viewport" data-ax-ref="viewport" style="overflow-y: auto; position: relative; flex: 1 1 auto; height: 100%; width: 100%;">
          <div class="virtual-list-spacer" data-ax-ref="spacer" data-ax-static style="box-sizing: border-box; width: 100%;">
            <!-- Recycled item DOM elements will be injected here -->
          </div>
        </div>
        <div class="virtual-list-pagination" data-ax-ref="pagination" style="display: none; box-sizing: border-box; padding: 8px 12px; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid rgba(0,0,0,0.1); user-select: none;">
          <div class="virtual-list-pagination-info" data-ax-ref="pageInfo" style="font-size: 13px; color: inherit;"></div>
          <div class="virtual-list-pagination-controls" style="display: flex; align-items: center; gap: 4px;">
            <button type="button" class="virtual-list-btn prev-btn" data-ax-ref="prevBtn" style="cursor: pointer; padding: 4px 10px; font-size: 13px;">&laquo; Prev</button>
            <span class="virtual-list-page-number" data-ax-ref="pageNum" style="font-size: 13px; padding: 0 4px;">1</span>
            <button type="button" class="virtual-list-btn next-btn" data-ax-ref="nextBtn" style="cursor: pointer; padding: 4px 10px; font-size: 13px;">Next &raquo;</button>
          </div>
        </div>
      </div>
      `,
      {},
      props
    );

    /** Measured actual heights of individual items. @type {number[]} */
    this.measuredHeights = [];
    /** The template node extracted from slot transclusion. @type {HTMLTemplateElement|null} */
    this.templateNode = null;
    /** Loop item variable name (e.g. 'item'). @type {string} */
    this.itemVar = 'item';
    /** Resize observer to monitor dynamic item size changes and viewport resizing. @type {ResizeObserver|null} */
    this.resizeObserver = null;
    /** Cached viewport height to prevent redundant layout loops. @type {number} */
    this.lastViewportHeight = 0;
    /** Animation frame request handle. @type {number|null} */
    this.rafId = null;
    /** Animation frame request handle for scroll throttling. @type {number|null} */
    this.scrollRafId = null;
    /** Currently active 1-based page index. @type {number} */
    this.currentPage = Number(props.page || props['current-page'] || 1);

    this.renderer = new TemplateRenderer();
    this.patcher = new DomPatcher();

    this.onScroll = this.onScroll.bind(this);
  }

  /**
   * Lifecycle hook called after component is mounted.
   * Sets up transcluded template slots, scroll listeners, and pagination handlers.
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

    if (this.$refs.prevBtn) {
      this.$refs.prevBtn.addEventListener('click', () => this.prevPage());
    }

    if (this.$refs.nextBtn) {
      this.$refs.nextBtn.addEventListener('click', () => this.nextPage());
    }

    if (this.$refs.spacer) {
      this.$refs.spacer.innerHTML = '';
    }
    this.measuredHeights = [];
    this.initResizeObserver();
    this.layout();
  }

  /**
   * Navigates to a specific page when pagination is enabled.
   * @param {number} targetPage - 1-based target page index.
   */
  goToPage(targetPage) {
    const pageSize = Number(this.props.pageSize || this.props['page-size'] || 0);
    if (pageSize <= 0) return;

    const allItems = this.props.items || [];
    const totalItems =
      this.props.totalItems !== undefined
        ? Number(this.props.totalItems)
        : this.props['total-items'] !== undefined
          ? Number(this.props['total-items'])
          : allItems.length;

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(totalPages, Math.max(1, Math.floor(targetPage)));

    if (this.currentPage !== page) {
      this.currentPage = page;
      if (this.$refs.viewport) {
        this.$refs.viewport.scrollTop = 0;
      }
      const eventDetail = {
        page,
        pageSize,
        totalPages,
        totalItems,
        startIndex: (page - 1) * pageSize,
        endIndex: Math.min(totalItems, page * pageSize),
      };
      this.$emit('page-change', eventDetail);
      this.$emit('pageChange', eventDetail);
      this.layout();
    }
  }

  /**
   * Navigates to the next page.
   */
  nextPage() {
    this.goToPage(this.currentPage + 1);
  }

  /**
   * Navigates to the previous page.
   */
  prevPage() {
    this.goToPage(this.currentPage - 1);
  }

  /**
   * Initializes unified ResizeObserver for viewport container and row items.
   */
  initResizeObserver() {
    if (this.resizeObserver || typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver((entries) => {
      let layoutNeeded = false;
      for (const entry of entries) {
        if (this.$refs.viewport && entry.target === this.$refs.viewport) {
          const newHeight = entry.target.clientHeight;
          if (newHeight !== this.lastViewportHeight) {
            this.lastViewportHeight = newHeight;
            layoutNeeded = true;
          }
        } else if (entry.target && entry.target.hasAttribute && entry.target.hasAttribute('data-index')) {
          const indexAttr = entry.target.getAttribute('data-index');
          if (indexAttr !== null) {
            const idx = parseInt(indexAttr, 10);
            const newHeight = entry.target.offsetHeight;
            if (newHeight && newHeight !== this.measuredHeights[idx]) {
              this.measuredHeights[idx] = newHeight;
              layoutNeeded = true;
            }
          }
        }
      }
      if (layoutNeeded) {
        this.scheduleLayout();
      }
    });

    if (this.$refs.viewport) {
      this.lastViewportHeight = this.$refs.viewport.clientHeight || 0;
      this.resizeObserver.observe(this.$refs.viewport);
    }
  }

  /**
   * Schedules layout recalculation on the next animation frame to prevent layout thrashing.
   */
  scheduleLayout() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.layout();
    });
  }

  /**
   * Lifecycle hook called after component updates.
   * Re-evaluates virtualization layouts when properties (e.g. items, page) change.
   */
  onUpdate() {
    const pageProp = this.props.page || this.props['current-page'];
    if (pageProp !== undefined) {
      this.currentPage = Number(pageProp);
    }
    this.layout();
  }

  /**
   * Lifecycle hook called when component unmounts.
   * Clean up event listeners and observers to prevent leaks.
   */
  onUnmount() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.scrollRafId) {
      cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }
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
   * Throttles scroll processing via requestAnimationFrame to align rendering with the screen refresh rate.
   */
  onScroll() {
    if (this.scrollRafId) return;

    this.scrollRafId = requestAnimationFrame(() => {
      this.scrollRafId = null;
      this.layout();
    });
  }

  /**
   * Creates a fresh element structure from the template to populate recycled element pool.
   * @returns {Element}
   */
  createItemElement() {
    const templateHTML = unescapeTemplateMarkers(this.templateNode.innerHTML);
    const tempDiv = document.createElement('div');
    const html = this.renderer.render(templateHTML, () => '').trim();
    tempDiv.innerHTML = html;
    let element = tempDiv.firstElementChild || document.createElement('div');
    element = this.patcher.cleanElement(element);
    return element;
  }

  /**
   * Measures visible DOM nodes and updates layout variables (e.g., offsets/heights/scrollbars/pagination).
   */
  layout() {
    if (!this.templateNode) return;

    const allItems = this.props.items || [];
    const pageSize = Number(this.props.pageSize || this.props['page-size'] || 0);
    const defaultHeight = Number(this.props.itemHeight || this.props['item-height']) || 40;
    const viewport = this.$refs.viewport;
    const spacer = this.$refs.spacer;
    const pagination = this.$refs.pagination;
    const pageInfo = this.$refs.pageInfo;
    const pageNum = this.$refs.pageNum;
    const prevBtn = this.$refs.prevBtn;
    const nextBtn = this.$refs.nextBtn;

    if (!viewport || !spacer) return;

    const totalItems =
      this.props.totalItems !== undefined
        ? Number(this.props.totalItems)
        : this.props['total-items'] !== undefined
          ? Number(this.props['total-items'])
          : allItems.length;

    let displayedItems = allItems;
    let pageOffset = 0;

    if (pageSize > 0) {
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const pageProp = Number(this.props.page || this.props['current-page'] || this.currentPage || 1);
      this.currentPage = Math.min(totalPages, Math.max(1, Math.floor(pageProp)));

      if (allItems.length > pageSize) {
        // Client-side pagination slicing
        pageOffset = (this.currentPage - 1) * pageSize;
        displayedItems = allItems.slice(pageOffset, pageOffset + pageSize);
      } else {
        // Server-side paginated items provided
        displayedItems = allItems;
        pageOffset = 0;
      }

      // Update Pagination Controls UI
      const showControls =
        this.props.showControls !== undefined
          ? Boolean(this.props.showControls)
          : this.props['show-controls'] !== undefined
            ? Boolean(this.props['show-controls'])
            : true;

      if (pagination && showControls) {
        pagination.style.display = 'flex';
        if (pageInfo) {
          pageInfo.textContent = `Page ${this.currentPage} of ${totalPages} (${totalItems} items)`;
        }
        if (pageNum) {
          pageNum.textContent = String(this.currentPage);
        }
        if (prevBtn) {
          prevBtn.disabled = this.currentPage <= 1;
        }
        if (nextBtn) {
          nextBtn.disabled = this.currentPage >= totalPages;
        }
      } else if (pagination) {
        pagination.style.display = 'none';
      }
    } else if (pagination) {
      pagination.style.display = 'none';
    }

    const items = displayedItems;
    const viewportHeight = viewport.clientHeight || 400;
    this.lastViewportHeight = viewportHeight;
    const scrollTop = viewport.scrollTop;

    // 1. Calculate heights array
    const heights = [];
    for (let i = 0; i < items.length; i++) {
      const globalIdx = pageOffset + i;
      heights.push(this.measuredHeights[globalIdx] !== undefined ? this.measuredHeights[globalIdx] : defaultHeight);
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

    // 6. Ensure unified ResizeObserver is initialized
    this.initResizeObserver();

    // 7. Dynamic patching and recycling of row elements
    const templateHTML = unescapeTemplateMarkers(this.templateNode.innerHTML);

    for (let i = 0; i < visibleCount; i++) {
      const itemIndex = startIndex + i;
      const globalIndex = pageOffset + itemIndex;
      const item = items[itemIndex];
      const domNode = spacer.childNodes[i];

      domNode.setAttribute('data-index', String(globalIndex));

      if (this.resizeObserver && domNode.nodeType === 1) {
        this.resizeObserver.observe(domNode);
      }

      // Resolver using parent context or component scope
      const resolver = (expr) => {
        const extraScope = {
          [this.itemVar]: item,
          index: globalIndex,
        };
        return this.$parent ? this.$parent._evaluate(expr, extraScope) : this._evaluate(expr, extraScope);
      };

      const renderedHTML = this.renderer.render(templateHTML, resolver).trim();
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = renderedHTML;
      let newElement = tempDiv.firstElementChild;
      if (newElement) {
        newElement = this.patcher.cleanElement(newElement);
        newElement.setAttribute('data-index', String(globalIndex));

        this.patcher.patchElement(domNode, newElement, resolver, this.$app);
      }
    }
  }
}
