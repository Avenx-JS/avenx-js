import { AvenxApp } from 'avenx-core/runtime';
import SuspenseCard from './components/suspense-card/suspense-card.component.js';
import ErrorCard from './components/error-card/error-card.component.js';
import UserCard from './components/user-card/user-card.component.js';
import RaceCard from './components/race-card/race-card.component.js';
import MutateCard from './components/mutate-card/mutate-card.component.js';
import PollCard from './components/poll-card/poll-card.component.js';
import AsyncChild from './components/async-child/async-child.component.js';

const app = new AvenxApp({ target: '#app' });

app.register('SuspenseCard', SuspenseCard);
app.register('ErrorCard', ErrorCard);
app.register('UserCard', UserCard);
app.register('RaceCard', RaceCard);
app.register('MutateCard', MutateCard);
app.register('PollCard', PollCard);
app.register('AsyncChild', AsyncChild);

app.initRouter({
  '': 'Suspense',
  '#/error-boundary': 'ErrorBoundary',
  '#/dependencies': 'Dependencies',
  '#/race': 'Race',
  '#/mutate': 'Mutate',
  '#/polling': 'Polling',
  '#/unmount': 'Unmount',
});
