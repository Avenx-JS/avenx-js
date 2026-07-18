import { performance } from 'perf_hooks';
import '../test/helpers/register-happy-dom.js';
import { AvenxComponent } from '../lib/core/runtime/AvenxComponent.js';

/**
 * Runs benchmarks on the DOM patching and list reconciliation system.
 */
function benchmark() {
  const iterations = 5000;

  // 1. Simple DOM Patching: Mounting and updating attributes / text
  const templateSimple = `
    <div class="user-card" id="card" @css card-theme>
      <h2 id="name-el">{{ name }}</h2>
      <p id="age-el">Age: {{ age }}</p>
      <p id="desc-el">{{ description }}</p>
    </div>
  `;

  const stateSimple = {
    name: 'Initial Name',
    age: 20,
    description: 'This is a long description used for benchmarking patching.',
  };

  const containerSimple = document.createElement('div');
  document.body.appendChild(containerSimple);

  const componentSimple = new AvenxComponent(stateSimple, {}, {}, templateSimple, {});
  componentSimple.mount(containerSimple);

  const startSimplePatch = performance.now();
  for (let i = 0; i < iterations; i++) {
    componentSimple.state.name = `Name ${i}`;
    componentSimple.state.age = 20 + (i % 80);
    componentSimple.state.description = `Desc ${i} - dynamic patching content`;
    componentSimple.update();
  }
  const endSimplePatch = performance.now();
  const simplePatchTime = endSimplePatch - startSimplePatch;

  // Cleanup
  componentSimple.unmount();
  document.body.removeChild(containerSimple);

  // 2. List Reconciliation DOM Patching
  const templateList = `
    <ul id="list-container">
      <template data-ax-for="items" data-ax-as="item" data-ax-key="item.id">
        <li class="item-row" data-id="{% item.id %}">
          <span>{% item.text %}</span>
          <strong>{% item.value %}</strong>
        </li>
      </template>
    </ul>
  `;

  const generateItems = (count) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`,
      text: `Item text content at index ${i}`,
      value: i * 10,
    }));
  };

  const stateList = {
    items: generateItems(50),
  };

  const containerList = document.createElement('div');
  document.body.appendChild(containerList);

  const componentList = new AvenxComponent(stateList, {}, {}, templateList, {});
  componentList.mount(containerList);

  const listIterations = 500;
  const startListPatch = performance.now();
  for (let i = 0; i < listIterations; i++) {
    const action = i % 5;
    if (action === 0) {
      componentList.state.items.reverse();
    } else if (action === 1) {
      componentList.state.items.push({ id: `new-${i}`, text: `Appended ${i}`, value: i });
    } else if (action === 2) {
      componentList.state.items.pop();
    } else if (action === 3) {
      for (let j = 0; j < Math.min(componentList.state.items.length, 10); j++) {
        componentList.state.items[j].value += 1;
      }
    } else if (action === 4) {
      componentList.state.items = generateItems(50);
    }
    componentList.update();
  }
  const endListPatch = performance.now();
  const listPatchTime = endListPatch - startListPatch;

  // Cleanup
  componentList.unmount();
  document.body.removeChild(containerList);

  // Calculate weighted ops/sec
  const totalOps = iterations + listIterations * 10;
  const totalTime = simplePatchTime + listPatchTime;
  const avgTime = totalTime / totalOps;

  console.log(`Running DOMPatching benchmark with ${iterations} simple and ${listIterations} list iterations...`);
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per operation: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
  console.log(`  - Simple patches: ${simplePatchTime.toFixed(2)}ms`);
  console.log(`  - List reconciliation: ${listPatchTime.toFixed(2)}ms`);
}

benchmark();
