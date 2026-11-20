import { AvenxApp } from 'avenx-core/runtime';
import BadgeLabel from './components/badge-label/badge-label.component.js';
import FrameCard from './components/frame-card/frame-card.component.js';
import ScopedList from './components/scoped-list/scoped-list.component.js';
import ProfileCard from './components/profile-card/profile-card.component.js';
import SettingsCard from './components/settings-card/settings-card.component.js';
import AsyncPanel from './components/async-panel/async-panel.component.js';
import ErrorPanel from './components/error-panel/error-panel.component.js';
import ShellLayout from './components/shell-layout/shell-layout.component.js';

/*
 * The parity fixture: every template construct the documentation lists,
 * grouped by page, built twice (`avenx build` and `avenx build --dev`) and
 * driven identically against both bundles by
 * specs/build/construct-parity.spec.js.
 *
 * Every construct sits in its own `data-construct` section. The spec compares
 * those sections between the two bundles one at a time, so a divergence names
 * the construct it is in.
 */
const app = new AvenxApp({ target: '#app' });

app.register('BadgeLabel', BadgeLabel);
app.register('FrameCard', FrameCard);
app.register('ScopedList', ScopedList);
app.register('ProfileCard', ProfileCard);
app.register('SettingsCard', SettingsCard);
app.register('AsyncPanel', AsyncPanel);
app.register('ErrorPanel', ErrorPanel);

app.initRouter({
  '/': 'Text',
  '/control': 'Control',
  '/forms': 'Forms',
  '/components': 'Components',
  '/async': 'Async',
  '/motion': 'Motion',
  '/string-path': 'StringPath',
  '/shell': {
    layout: ShellLayout,
    children: [{ path: '/outlet', page: 'Outlet' }],
  },
});
