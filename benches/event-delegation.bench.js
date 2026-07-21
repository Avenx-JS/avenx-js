import { performance } from 'perf_hooks';
import '../test/helpers/register-happy-dom.js';
import { AvenxComponent } from '../lib/core/runtime/AvenxComponent.js';

console.log('Running event delegation benchmark...');

// Find prototype containing addEventListener for standard elements in this environment
const div = document.createElement('div');
let targetProto = Object.getPrototypeOf(div);
while (targetProto) {
  if (targetProto.hasOwnProperty('addEventListener')) {
    break;
  }
  targetProto = Object.getPrototypeOf(targetProto);
}

if (!targetProto) {
  targetProto = EventTarget.prototype;
}

let listenerAllocations = 0;
const originalAdd = targetProto.addEventListener;
targetProto.addEventListener = function (type, listener, options) {
  listenerAllocations++;
  return originalAdd.call(this, type, listener, options);
};

const itemCount = 1000;
const items = Array.from({ length: itemCount }, (_, i) => ({ id: i, name: `Item ${i}` }));

class ListComponent extends AvenxComponent {
  constructor() {
    super(
      { items },
      {},
      {},
      `
      <div class="list-container">
        <@for item in state.items key="item.id">
          <div class="list-item" @click="selectItem(item)" @input="inputItem(item)" @change="changeItem(item)" @keydown.enter="enterItem(item)">
            <span>{% item.name %}</span>
          </div>
        </@for>
      </div>
      `,
      {
        selectItem() {},
        inputItem() {},
        changeItem() {},
        enterItem() {},
      }
    );
  }
}

function runBenchmark() {
  const container = document.createElement('div');
  document.body.appendChild(container);

  listenerAllocations = 0;
  const start = performance.now();

  const comp = new ListComponent();
  comp.__setMountTarget(container);
  comp.runUpdate();

  const end = performance.now();
  const duration = end - start;

  console.log(`\n======================================`);
  console.log(`📊 Event Delegation Benchmark Results`);
  console.log(`======================================`);
  console.log(`Items rendered: ${itemCount}`);
  console.log(`Render time: ${duration.toFixed(2)}ms`);
  console.log(`Active event listeners allocated: ${listenerAllocations}`);
  console.log(`======================================\n`);

  // Cleanup
  comp.unmount();
  document.body.removeChild(container);
}

runBenchmark();
// Restore
targetProto.addEventListener = originalAdd;
