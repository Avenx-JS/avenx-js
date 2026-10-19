import { AvenxApp } from 'avenx-core/runtime';
import Susp from './components/susp/susp.component.js';
import Eb from './components/eb/eb.component.js';
import Dl from './components/dl/dl.component.js';
import Scoped from './components/scoped/scoped.component.js';

const app = new AvenxApp({ target: '#app' });

// The page compiles to a render program; the three children below are each
// refused by the IR and render through the fallback path. One page therefore
// exercises both engines at once, which is the arrangement that broke.
app.register('Susp', Susp);
app.register('Eb', Eb);
app.register('Dl', Dl);
app.register('Scoped', Scoped);

app.initRouter({
  '': 'Shell',
  '/scoped': 'Scoped',
});
