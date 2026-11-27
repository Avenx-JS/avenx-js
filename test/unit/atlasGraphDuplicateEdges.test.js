import assert from 'node:assert/strict';
import graphlibDot from '@dagrejs/graphlib-dot';
import { AppModel, AtlasEdgeKind, AtlasNodeKind } from '../../lib/compiler/atlas/AppModel.js';
import { renderAtlasGraph } from '../../lib/compiler/atlas/graph.js';

console.log('🧪 Testing Atlas graph relationship de-duplication...');

try {
  const model = new AppModel();
  model.addNode({ id: 'component:Card', kind: AtlasNodeKind.COMPONENT, name: 'Card' });
  model.addNode({ id: 'page:Home', kind: AtlasNodeKind.PAGE, name: 'Home' });
  model.addNode({ id: 'route:/', kind: AtlasNodeKind.ROUTE, name: '/' });
  model.addEdge({
    from: 'page:Home',
    to: 'component:Card',
    kind: AtlasEdgeKind.RENDERS,
    confidence: 'certain',
    loc: { file: 'src/pages/home.page.js', line: 3 },
  });
  model.addEdge({
    from: 'page:Home',
    to: 'component:Card',
    kind: AtlasEdgeKind.RENDERS,
    confidence: 'certain',
    loc: { file: 'src/pages/home.page.js', line: 8 },
  });
  model.addEdge({
    from: 'page:Home',
    to: 'component:Card',
    kind: AtlasEdgeKind.IMPORTS,
    confidence: 'certain',
  });
  model.addEdge({ from: 'route:/', to: 'page:Home', kind: AtlasEdgeKind.ROUTES_TO, confidence: 'certain' });

  const mermaid = renderAtlasGraph(model);
  const labels = new Map([...mermaid.matchAll(/^ {2}(n\d+)\["([^"\n]*)"\]$/gm)].map((match) => [match[1], match[2]]));
  const arrows = [...mermaid.matchAll(/^ {2}(n\d+) (?:-->|-\.->)\|"([^"\n]*)"\| (n\d+)$/gm)].map((match) => ({
    from: labels.get(match[1]),
    kind: match[2],
    to: labels.get(match[3]),
  }));
  const renderArrows = arrows.filter((edge) => edge.kind === AtlasEdgeKind.RENDERS);
  assert.equal(renderArrows.length, 1, 'repeated component usage draws one renders arrow');
  assert.deepEqual(
    renderArrows[0],
    { from: 'page: Home', kind: AtlasEdgeKind.RENDERS, to: 'component: Card' },
    'the remaining renders arrow connects the page to the component',
  );
  assert.equal(
    arrows.filter(
      (edge) => edge.from === 'page: Home' && edge.to === 'component: Card' && edge.kind === AtlasEdgeKind.IMPORTS,
    ).length,
    1,
    'a different relationship between the same pair keeps its own arrow',
  );
  const styles = [...mermaid.matchAll(/^ {2}linkStyle (\d+) stroke:#[0-9a-f]{6}$/gm)].map((match) => Number(match[1]));
  assert.deepEqual(
    styles,
    arrows.map((_, index) => index),
    'linkStyle indexes stay contiguous and match their arrows',
  );

  const dot = graphlibDot.read(renderAtlasGraph(model, { format: 'dot' }));
  assert.equal(dot.edgeCount(), arrows.length, 'DOT output also draws one arrow per distinct relationship');

  const mixed = new AppModel();
  mixed.addNode({ id: 'component:Card', kind: AtlasNodeKind.COMPONENT, name: 'Card' });
  mixed.addNode({ id: 'page:Home', kind: AtlasNodeKind.PAGE, name: 'Home' });
  mixed.addEdge({
    from: 'page:Home',
    to: 'component:Card',
    kind: AtlasEdgeKind.RENDERS,
    confidence: 'possible',
    loc: { file: 'src/pages/home.page.js', line: 3 },
  });
  mixed.addEdge({
    from: 'page:Home',
    to: 'component:Card',
    kind: AtlasEdgeKind.RENDERS,
    confidence: 'certain',
    loc: { file: 'src/pages/home.page.js', line: 8 },
  });
  const mixedMermaid = renderAtlasGraph(mixed);
  assert.equal((mixedMermaid.match(/\|"renders"\|/g) || []).length, 1, 'a possible and a certain copy draw one arrow');
  assert.match(mixedMermaid, / --> *\|"renders"\|/, 'the certain copy decides the arrow style');
  assert.doesNotMatch(mixedMermaid, /-\.->/, 'no dashed arrow when one copy is certain');

  console.log('✅ Atlas graph de-duplicates repeated relationships.');
} catch (err) {
  console.error('❌ Atlas graph de-duplication test failed:', err);
  process.exit(1);
}
