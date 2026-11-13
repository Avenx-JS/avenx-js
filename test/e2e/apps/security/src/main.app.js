import { AvenxApp } from 'avenx-core/runtime';
import { html } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

// A page action needs `html` to opt a value into trusted markup; expose it the
// way a real app would, on the global the template scope can reach.
if (typeof window !== 'undefined') {
  window.avenxHtml = html;
}

app.initRouter({
  '': 'Srcdoc',
  '#/dynamic-attr': 'DynamicAttr',
  '#/ax-html': 'AxHtml',
});
