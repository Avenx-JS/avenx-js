import { AvenxApp } from 'avenx-core/runtime';
// The chart components are built by the plugin, not compiled from this
// project's source, so they render through Avenx's string renderer at runtime.
// A compiled application drops that renderer unless something asks for it; this
// import is that request. It adds ~87 KB and is only needed because the chart
// comes from a plugin — an application whose own templates all compile does not
// write this line.
import 'avenx-core/runtime/string-renderer';

/* global AvenxCharts -- loaded from a <script> tag; see index.html. */

const app = new AvenxApp({ target: '#app' });

// One line installs the plugin: it registers the chart components (chart.line
// among them) so the compiled page's <div data-avenx-comp="chart.line"> finds
// a class to mount. Nothing else on the page has to know charts exist.
app.use(AvenxCharts.avenxCharts);

app.initRouter({
  '/': 'Dashboard',
});
