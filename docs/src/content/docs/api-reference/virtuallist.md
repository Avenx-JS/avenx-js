# <VirtualList>

The `<VirtualList>` component is a built-in, globally available component designed for high-performance virtualized list rendering of massive datasets. It automatically handles dynamic element recycling, layout paddings, and dynamic item height updates.

## Props

| Prop | Type | Description |
| :--- | :--- | :--- |
| `items` | `Array` | The dataset array to be rendered in the list. |
| `itemHeight` / `item-height` | `Number` | The height of each item. Supports both camelCase (`itemHeight`) and kebab-case (`item-height`). |

> **Note:** `<VirtualList>` includes built-in `ResizeObserver` support to handle dynamic row resizing automatically.

---

## Usage Example

To pass templates into the `<VirtualList>`, use the `data-ax-as="item"` directive on your template slot:

```html
<VirtualList :item-height="50" :items="myLargeDataset">
  <template data-ax-as="item" let:item>
    <div class="list-item">
      <h3>{{ item.title }}</h3>
      <p>{{ item.description }}</p>
    </div>
  </template>
</VirtualList>