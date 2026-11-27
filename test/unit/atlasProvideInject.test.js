import assert from 'assert';
import { AppModel, AtlasEdgeKind, AtlasNodeKind, UnresolvedReason, nodeId } from '../../lib/compiler/atlas/AppModel.js';
import { addComponentUnit, addRenderEdges, resolveProvideInjectEdges } from '../../lib/compiler/atlas/build.js';
import { resolveReference } from '../../lib/compiler/atlas/resolve.js';
import { resolveSymbol, walk } from '../../lib/compiler/atlas/query.js';

console.log('🧪 Testing Atlas Provide / Inject Modeling...');

const ROOT_DIR = '/test-project';

// ---------------------------------------------------------------------------
// 1. Node Creation & PROVIDES Edges
// ---------------------------------------------------------------------------
{
  const model = new AppModel();
  const providerContent = `
<state theme="dark" />
<action name="setTheme">this.state.theme = 'light';</action>
<provide>
  theme
  setTheme
</provide>
<div>Provider</div>
`;

  addComponentUnit(model, {
    name: 'Provider',
    kind: 'component',
    filePath: '/test-project/src/Provider.component.js',
    rootDir: ROOT_DIR,
    content: providerContent,
    state: { theme: 'dark' },
    computed: {},
    methods: { setTheme: "this.state.theme = 'light';" },
    resources: {},
    provide: ['theme', 'setTheme'],
    inject: [],
  });

  const stateNode = nodeId(AtlasNodeKind.STATE, 'component:Provider', 'theme');
  const actionNode = nodeId(AtlasNodeKind.ACTION, 'component:Provider', 'setTheme');
  const provideThemeNode = nodeId(AtlasNodeKind.PROVIDE, 'component:Provider', 'theme');
  const provideSetThemeNode = nodeId(AtlasNodeKind.PROVIDE, 'component:Provider', 'setTheme');

  assert.ok(model.hasNode(stateNode), 'has state:theme node');
  assert.ok(model.hasNode(actionNode), 'has action:setTheme node');
  assert.ok(model.hasNode(provideThemeNode), 'has provide:theme node');
  assert.ok(model.hasNode(provideSetThemeNode), 'has provide:setTheme node');

  // Verify DECLARES edges
  const declares = model.outgoing('component:Provider').filter((e) => e.kind === AtlasEdgeKind.DECLARES);
  assert.ok(
    declares.some((e) => e.to === provideThemeNode),
    'owner declares provide:theme',
  );
  assert.ok(
    declares.some((e) => e.to === provideSetThemeNode),
    'owner declares provide:setTheme',
  );

  // Verify PROVIDES edges linking provide -> state / action
  const provideThemeEdges = model.outgoing(provideThemeNode);
  const providesStateEdge = provideThemeEdges.find((e) => e.to === stateNode && e.kind === AtlasEdgeKind.PROVIDES);
  assert.ok(providesStateEdge, 'provide:theme has PROVIDES edge to state:theme');

  const provideSetThemeEdges = model.outgoing(provideSetThemeNode);
  const providesActionEdge = provideSetThemeEdges.find((e) => e.to === actionNode && e.kind === AtlasEdgeKind.PROVIDES);
  assert.ok(providesActionEdge, 'provide:setTheme has PROVIDES edge to action:setTheme');
}

// ---------------------------------------------------------------------------
// 2. resolveReference for Injected Keys
// ---------------------------------------------------------------------------
{
  const scope = {
    ownerId: 'component:Child',
    ownerKind: 'component',
    state: new Set(),
    computed: new Set(),
    actions: new Set(),
    resources: new Set(),
    injected: new Set(['theme', 'currentTheme', 'setTheme']),
    locals: new Set(),
  };

  // Bare identifier
  const resBare = resolveReference({ root: 'currentTheme', segments: [], text: 'currentTheme' }, scope);
  assert.strictEqual(resBare.unresolved, null, 'bare injected key resolves without error');
  assert.deepStrictEqual(
    resBare.target,
    { kind: AtlasNodeKind.INJECT, owner: 'component:Child', name: 'currentTheme' },
    'resolves to inject node',
  );

  // this.<member>
  const resThis = resolveReference({ root: 'this', segments: ['setTheme'], text: 'this.setTheme' }, scope);
  assert.strictEqual(resThis.unresolved, null, 'this.setTheme resolves without error');
  assert.deepStrictEqual(
    resThis.target,
    { kind: AtlasNodeKind.INJECT, owner: 'component:Child', name: 'setTheme' },
    'resolves this.setTheme to inject node',
  );

  // Unknown identifier
  const resUnknown = resolveReference({ root: 'otherKey', segments: [], text: 'otherKey' }, scope);
  assert.ok(resUnknown.unresolved, 'unknown key is reported unresolved');
  assert.strictEqual(resUnknown.unresolved.reason, UnresolvedReason.UNKNOWN_IDENTIFIER);
}

// ---------------------------------------------------------------------------
// 3. Tree Resolution: INJECTS Edges Across Hierarchy & Shadowing
// ---------------------------------------------------------------------------
{
  const model = new AppModel();

  // Root Provider
  const providerContent = `
<state theme="dark" />
<provide theme />
<Wrapper />
`;
  addComponentUnit(model, {
    name: 'Provider',
    kind: 'component',
    filePath: '/test-project/src/Provider.component.js',
    rootDir: ROOT_DIR,
    content: providerContent,
    state: { theme: 'dark' },
    computed: {},
    methods: {},
    resources: {},
    provide: ['theme'],
    inject: [],
  });

  // Intermediate Wrapper (does not inject or provide)
  const wrapperContent = `
<div>
  <Child />
</div>
`;
  addComponentUnit(model, {
    name: 'Wrapper',
    kind: 'component',
    filePath: '/test-project/src/Wrapper.component.js',
    rootDir: ROOT_DIR,
    content: wrapperContent,
    state: {},
    computed: {},
    methods: {},
    resources: {},
    provide: [],
    inject: [],
  });

  // Deep Consumer
  const childContent = `
<inject currentTheme="theme" />
<div>{{ currentTheme }}</div>
`;
  addComponentUnit(model, {
    name: 'Child',
    kind: 'component',
    filePath: '/test-project/src/Child.component.js',
    rootDir: ROOT_DIR,
    content: childContent,
    state: {},
    computed: {},
    methods: {},
    resources: {},
    provide: [],
    inject: { currentTheme: 'theme' },
  });

  // Connect RENDERS edges: Provider -> Wrapper -> Child
  const known = new Map([
    ['Provider', 'component:Provider'],
    ['Wrapper', 'component:Wrapper'],
    ['Child', 'component:Child'],
  ]);

  addRenderEdges(model, {
    ownerId: 'component:Provider',
    content: providerContent,
    file: 'src/Provider.component.js',
    known,
  });

  addRenderEdges(model, {
    ownerId: 'component:Wrapper',
    content: wrapperContent,
    file: 'src/Wrapper.component.js',
    known,
  });

  // Resolve provide/inject edges
  resolveProvideInjectEdges(model);

  const injectNodeId = nodeId(AtlasNodeKind.INJECT, 'component:Child', 'currentTheme');
  const provideNodeId = nodeId(AtlasNodeKind.PROVIDE, 'component:Provider', 'theme');

  const injectEdges = model.outgoing(injectNodeId).filter((e) => e.kind === AtlasEdgeKind.INJECTS);
  assert.strictEqual(injectEdges.length, 1, 'Child has 1 INJECTS edge');
  assert.strictEqual(injectEdges[0].to, provideNodeId, 'Child INJECTS points across Wrapper to Provider');

  // Verify avenx why traversal (direction: out) from inject node
  const whyResult = walk(model, injectNodeId, { direction: 'out' });
  const whyNodeIds = [];
  const collectWhy = (entry) => {
    const id = entry.node ? entry.node.id : entry.root ? entry.root.node.id : null;
    if (id) whyNodeIds.push(id);
    (entry.children || []).forEach(collectWhy);
  };
  collectWhy(whyResult);

  assert.ok(whyNodeIds.includes(provideNodeId), 'why Child.currentTheme reaches Provider.theme (provide node)');
  assert.ok(
    whyNodeIds.includes(nodeId(AtlasNodeKind.STATE, 'component:Provider', 'theme')),
    'why Child.currentTheme reaches Provider.theme (state node)',
  );

  // Verify avenx impact traversal (direction: in) from provider's state node
  const stateNodeId = nodeId(AtlasNodeKind.STATE, 'component:Provider', 'theme');
  const impactResult = walk(model, stateNodeId, { direction: 'in' });
  const impactNodeIds = [];
  const collectImpact = (entry) => {
    const id = entry.node ? entry.node.id : entry.root ? entry.root.node.id : null;
    if (id) impactNodeIds.push(id);
    (entry.children || []).forEach(collectImpact);
  };
  collectImpact(impactResult);

  assert.ok(impactNodeIds.includes(provideNodeId), 'impact on Provider.theme reaches provide node');
  assert.ok(impactNodeIds.includes(injectNodeId), 'impact on Provider.theme reaches Child.currentTheme (inject node)');

  // Symbol resolution
  const resolvedChild = resolveSymbol(model, 'Child.currentTheme');
  assert.ok(resolvedChild.length > 0 && resolvedChild[0].id === injectNodeId, 'resolves Child.currentTheme');
}

// ---------------------------------------------------------------------------
// 4. Missing Provider Unresolved Handling
// ---------------------------------------------------------------------------
{
  const model = new AppModel();
  const orphanContent = `
<inject missingKey="theme" />
<div>{{ missingKey }}</div>
`;

  addComponentUnit(model, {
    name: 'OrphanChild',
    kind: 'component',
    filePath: '/test-project/src/OrphanChild.component.js',
    rootDir: ROOT_DIR,
    content: orphanContent,
    state: {},
    computed: {},
    methods: {},
    resources: {},
    provide: [],
    inject: { missingKey: 'theme' },
  });

  resolveProvideInjectEdges(model);

  assert.strictEqual(model.unresolved.length, 1, 'records unresolved entry for missing provider');
  assert.strictEqual(model.unresolved[0].reason, UnresolvedReason.UNKNOWN_IDENTIFIER);
  assert.strictEqual(model.unresolved[0].name, 'theme');
  assert.strictEqual(model.unresolved[0].owner, 'component:OrphanChild');
}

console.log('✅ Atlas Provide / Inject Modeling tests passed!');
