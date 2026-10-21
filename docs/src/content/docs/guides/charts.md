---
title: 'Charts (@avenx/charts)'
description: 'Declarative, reactive SVG line charts for Avenx applications.'
---

`@avenx/charts` is the official charts plugin for Avenx. It adds a line chart component that renders an SVG chart from a reactive array and redraws whenever that array changes.

Only the line chart exists today. The package exports two components, `ChartLine` and `BaseChart`. `BaseChart` is the shared base class (layout, axes, grid, legend, tooltip) for anyone writing a custom chart type. Other chart types such as bar, area and pie are not implemented yet.

---

## Installation

```bash
npm install @avenx/charts
```

The plugin requires `avenx-core` `>=0.4.0` as a peer dependency.

## Register the plugin

Install the plugin on your application with `app.use`:

```js
import { avenxCharts } from '@avenx/charts';

app.use(avenxCharts);
```

This registers the line chart under three tag names: `chart.line`, `ChartLine` and `chart-line`. `BaseChart` is also registered, for components that extend it.

If your application is compiled with the Avenx CLI rather than a bundler, the plugin is loaded from a script tag instead. See [Using the global script build](#using-the-global-script-build).

## Add a chart to a page

Bind the chart to reactive state with the `ChartLine` tag:

```html
<state
    sales="[
        { month: 'Jan', value: 120 },
        { month: 'Feb', value: 240 },
        { month: 'Mar', value: 180 }
    ]"
/>

<ChartLine :data="sales" x="month" y="value" grid dots fill legend tooltip />
```

`:data="sales"` is a reactive binding. When an action gives `sales` a new value, the chart redraws. `x` and `y` name the keys to read from each row, and the bare attributes `grid dots fill legend tooltip` switch features on.

To pass an array or an object, use the bound form:

```html
<ChartLine :data="metrics" x="month" :y="['revenue', 'profit']" legend />
```

:::note
Assign a new array instead of pushing into the old one, for example `sales = [...sales, point]`. The new value is what triggers the redraw.
:::

### The `<chart.line />` shorthand

The plugin also ships a shorthand that a template preprocessor expands at build time. Under a bundler this is handled by `@avenx/vite`:

```html
<chart.line data={sales} x="month" y={['revenue','profit']} grid legend />
```

The preprocessor turns each chart tag into a placeholder element that carries its props as `data-props-*` attributes:

```html
<div data-avenx-comp="chart.line" data-props-data="sales" data-props-x="'month'" data-props-y="['revenue','profit']" data-props-grid="true" data-props-legend="true"></div>
```

How each attribute is rewritten:

| In the template | Becomes | Meaning |
|---|---|---|
| `data={sales}` | `sales` | A brace expression is passed through as an expression. |
| `x="month"` | `'month'` | A quoted value is a string literal. |
| `grid` | `true` | A bare attribute is a boolean `true`. |

:::caution
**Pass arrays and objects in braces.** `y={['revenue','profit']}` gives two series. The quoted form `y="['revenue','profit']"` is a plain string, so it is treated as one series whose key is that whole text. Nothing in your data has that key, so the chart draws a single flat line at 0.
:::

The shorthand is optional. The `ChartLine` tag above compiles under every build setup and needs no preprocessor.

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `data` | `Array<object>` | `[]` | The dataset. Reactive arrays are supported. With no rows, the chart shows "No data available". |
| `x` | `string` | `'x'` | Key in each row used for the X axis categories. A row without that key is labelled `Point N`. |
| `y` (alias `series`) | `string`, `string[]` or `object[]` | `'value'` | Key or keys to plot, one line per key. See [Series](#series). |
| `curve` | `'smooth'`, `'linear'` or `'step'` | `'smooth'` | Line shape. Any other value falls back to `'smooth'`. |
| `stepPosition` | `'after'`, `'before'` or `'middle'` | `'after'` | Where each step happens. Used only when `curve="step"`. |
| `strokeWidth` (or `stroke-width`) | `number` | `2.5` | Line thickness. |
| `fill` | `boolean` | `false` | Fills the area under each line with a gradient. `gradient` and `area` are aliases. |
| `dots` | `boolean` | `false` | Draws a dot on every data point. |
| `grid` | `boolean` | `false` | Draws horizontal gridlines. |
| `legend` | `boolean` | `false` | Shows a legend above the chart. Clicking an entry hides or shows that series. |
| `tooltip` | `boolean` | `false` | Shows a tooltip and a crosshair while the pointer or finger is over the chart. |
| `zero` | `boolean` | `true` | Includes 0 in the Y axis range. Pass `false` to fit the axis to the data. |
| `theme` | `'light'`, `'dark'` or `object` | `'light'` | See [Theming](#theming). |
| `width` | `number` | container width, or 600 | Chart width in pixels. By default the chart follows its container. |
| `height` | `number` | `320` | Chart height in pixels. |
| `margin` | `object` | `{ top: 24, right: 24, bottom: 38, left: 52 }` | Plot margins. You can override only some sides. |

Boolean props (`fill`, `dots`, `grid`, `legend`, `tooltip`) are switched on by `true`, `'true'`, `1`, `'1'` or a bare attribute.

### Series

`y` accepts three forms:

```js
y="value"                           // one series
y={['revenue', 'profit']}           // several series
y={[
  { key: 'revenue', name: 'Revenue', color: '#6366f1' },
  { key: 'profit', label: 'Profit', hidden: true },
]}                                   // full control
```

An object can set `key` (or `y`), `name` (or `label`), `color` and `hidden`. When no name is given, it is the key with the first letter capitalised and camelCase split into words, so `netProfit` is labelled "Net Profit".

If a row has no value for a series key, that point is plotted as 0.

### Colors

Series colors cycle through six defaults: `#6366f1`, `#10b981`, `#f59e0b`, `#ec4899`, `#06b6d4` and `#8b5cf6`. To choose a color yourself, give that series a `color` in the object form of `y`.

### Events

The chart emits standard component events with `$emit`, so you listen with the `@` syntax described in [Events](/core-concepts/events).

| Event | Payload | When |
|---|---|---|
| `hover` | `{ index, data, x }` | The pointer moves to a new data point. Only fires when `tooltip` is on. |
| `leave` | `{}` | The pointer leaves the chart. |
| `series-toggle` | `{ key, hidden }` | A legend entry is clicked. |

```html
<ChartLine :data="sales" x="month" y="value" tooltip legend @hover="onHover()" @series-toggle="onToggle()" />
```

## Theming

`theme` takes a built-in name, `'light'` or `'dark'`. An unknown name falls back to light.

To customise, pass an object. It is merged over the light theme, or over the dark theme when it contains `mode: 'dark'`:

```js
theme={{ mode: 'dark', gridColor: 'rgba(148, 163, 184, 0.2)', fontSize: '12px' }}
```

Keys you can override: `background`, `textColor`, `textMuted`, `gridColor`, `axisColor`, `tooltipBg`, `tooltipText`, `tooltipBorder`, `tooltipShadow`, `crosshairColor`, `fontFamily` and `fontSize`.

## Scale helpers

The scale and extent helpers that the charts are built on are exported from `@avenx/charts`, so you can use them for your own SVG.

| Helper | Description |
|---|---|
| `createLinearScale(domain, range, options)` | Maps numbers to a range. Options: `clamp` (default `false`), `nice` (default `true`, extends the domain to round numbers) and `tickCount` (default `5`). The returned function also has `.domain`, `.range`, `.ticks(count)` and `.invert(value)`. A domain with equal ends is widened so the scale never divides by zero. |
| `createPointScale(domain, range, options)` | Maps categories to evenly spaced points. Option: `padding` (default `0.5`). The returned function has `.step()` and `.ticks()`. |
| `createBandScale(domain, range, options)` | Maps categories to bands. Options: `paddingInner` (default `0.2`) and `paddingOuter` (default `0.1`). Adds `.bandwidth()`. |
| `generateLinearTicks(min, max, count)` | Returns round tick values covering `min` to `max`, aiming for `count` of them (default `5`). Equal bounds return `[min]`. |
| `getExtent(data, keys, options)` | Returns `[min, max]` across one or more keys. Option: `includeZero` (default `true`). Empty or non-numeric data returns `[0, 100]`. |

A category that is not in the domain maps to the first position of a point or band scale.

## Using the global script build

:::caution
**Toolchain.** With a bundler (Vite via `@avenx/vite`, Rollup, webpack) the imports above are all you need. The **Avenx CLI compiler** produces one self-contained bundle with the runtime inside, so the plugin cannot import it. Build the standalone plugin bundle with `npm run build` in `plugins/avenx-charts`, which writes `dist/avenx-charts.global.js` and a minified `dist/avenx-charts.global.min.js`. Load it from `index.html` **before** the application bundle, then call `app.use(AvenxCharts.avenxCharts)` in your app entry.
:::

```html
<script src="path/to/avenx-charts.global.js"></script>
<script src="dist/bundle.js"></script>
```

The plugin script goes first so that `AvenxCharts` exists when the application calls `app.use`. The chart classes find the Avenx runtime when the first chart is built, after the application bundle has published it. If the runtime is missing, that first chart throws an error saying the Avenx runtime was not found.

Two more things are needed in a CLI-compiled application:

- **Import the string renderer.** The chart components come from the plugin, not from your `src/`, so they render through Avenx's string renderer at runtime. A compiled application drops that renderer unless you ask for it. The import adds about 87 KB and is only needed because the chart comes from a plugin.
- **Silence warning `AVX_W46`.** `ChartLine` is registered at runtime, so the compiler cannot see it and reports an unresolved component. Turn that one warning off in `avenx.config.json`.

```json
{
  "warnings": {
    "AVX_W46": "off"
  }
}
```

## Complete example

A page with a reactive `sales` array and two actions that change it.

```html
<state
    sales="[
        { month: 'Jan', value: 120 },
        { month: 'Feb', value: 240 },
        { month: 'Mar', value: 180 },
        { month: 'Apr', value: 410 }
    ]"
    next="5"
/>

<action name="addPoint">
    const month = 'M' + next;
    const value = 80 + Math.round(Math.random() * 420);
    sales = [...sales, { month, value }];
    next = next + 1;
</action>

<action name="reset">
    sales = [
        { month: 'Jan', value: 120 },
        { month: 'Feb', value: 240 },
        { month: 'Mar', value: 180 },
        { month: 'Apr', value: 410 }
    ];
    next = 5;
</action>

<div>
    <h1>Monthly sales</h1>
    <p>{{ sales.length }} points. Add one and watch the line redraw.</p>

    <ChartLine :data="sales" x="month" y="value" grid dots fill legend tooltip />

    <button @click="addPoint()">Add a point</button>
    <button @click="reset()">Reset</button>
</div>
```

The application entry installs the plugin. This version is for the CLI build with the global script:

```js
import { AvenxApp } from 'avenx-core/runtime';
import 'avenx-core/runtime/string-renderer';

/* global AvenxCharts -- loaded from a <script> tag */

const app = new AvenxApp({ target: '#app' });

app.use(AvenxCharts.avenxCharts);

app.initRouter({
  '/': 'Dashboard',
  '#/': 'Dashboard',
});
```

With a bundler, drop the script tag and the global, and import the plugin instead:

```js
import { avenxCharts } from '@avenx/charts';

app.use(avenxCharts);
```

The full runnable version lives in `plugins/avenx-charts/example`. Its README explains how to build and serve it.
