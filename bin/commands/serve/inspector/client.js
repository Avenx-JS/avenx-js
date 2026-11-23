const channel = new BroadcastChannel('avenx-inspector-channel');
let lastUpdate = 0;
let connectionStatus = null;

function updateStatus(connected) {
    if (connectionStatus === connected) return;
    connectionStatus = connected;
    const badge = document.getElementById('statusBadge');
    if (connected) {
        badge.textContent = '● Connected';
        badge.className = 'badge connected';
    } else {
        badge.textContent = '○ Disconnected';
        badge.className = 'badge disconnected';
    }
}

let latestData = null;
let selectedComponentId = null;
let selectedTimelineId = null;
const expandedNodeIds = new Set();
let initialExpandDone = false;

function toggleNode(nodeId) {
    if (expandedNodeIds.has(nodeId)) {
        expandedNodeIds.delete(nodeId);
    } else {
        expandedNodeIds.add(nodeId);
    }
    if (latestData) {
        renderComponentTree(latestData);
    }
}

function selectComponent(nodeId) {
    selectedComponentId = nodeId;
    if (latestData) {
        renderComponentTree(latestData);
        renderSelectedComponent(latestData);
    }
}

function selectTimelineEntry(entryId) {
    selectedTimelineId = entryId;
    if (latestData) {
        renderTimeline(latestData);
        renderSelectedTimeline(latestData);
    }
}

function onNodeHover(id) {
    channel.postMessage({ type: 'highlight-component', id: id });
}

function onNodeLeave() {
    channel.postMessage({ type: 'clear-highlight' });
}

channel.onmessage = (event) => {
    if (event.data && event.data.type === 'inspect-data') {
        updateStatus(true);
        lastUpdate = Date.now();
        latestData = event.data.data;
        renderDashboard(latestData);
    }
};

// Render server config immediately
const config = window.__avenx_config || {};
document.getElementById('confPort').textContent = config.server?.port || '3000';
document.getElementById('confHost').textContent = config.server?.host || 'localhost';
document.getElementById('confSrc').textContent = config.srcDir || 'src';
document.getElementById('confDist').textContent = config.distDir || 'dist';

// Request data periodically to establish connection
function requestUpdate() {
    channel.postMessage('request-inspect-data');
    // If no message received for 2.5 seconds, show disconnected
    if (Date.now() - lastUpdate > 2500) {
        updateStatus(false);
    }
}

setInterval(requestUpdate, 1000);
requestUpdate();

// Everything below is application data -- component state, props,
// bridge state, route params -- and it routinely holds whatever a user
// typed or an API returned. It is written with innerHTML, so it is
// escaped first; an inspector that renders the app's own data as markup
// is a script-execution sink on the dev server's origin.
function esc(value) {
    return String(value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function findNodeById(nodes, id) {
    if (!nodes) return null;
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children && node.children.length > 0) {
            const found = findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
}

function renderSelectedComponent(data) {
    const container = document.getElementById('selectedComponentInfo');
    if (!container) return;
    const tree = data.componentTree || [];
    const flat = data.activeComponents || [];
    const node = findNodeById(tree, selectedComponentId) || flat.find(c => c.id === selectedComponentId);
    if (!node) {
        container.innerHTML = '<div style="color:var(--text-muted);">Click a component in the tree to inspect its props and state.</div>';
        return;
    }

    container.innerHTML = `
        <div style="margin-bottom:0.25rem;"><strong>Component:</strong> <span style="color:var(--accent-blue);font-weight:600;">&lt;${esc(node.name)}&gt;</span></div>
        <div style="margin-bottom:0.25rem;"><strong>Instance ID:</strong> <span class="tag-badge">${esc(node.id)}</span></div>
        ${node.key !== null && node.key !== undefined ? `<div style="margin-bottom:0.25rem;"><strong>Key:</strong> <span class="tag-badge key-badge">${esc(node.key)}</span></div>` : ''}
        <div style="margin-bottom:0.25rem;"><strong>Parent:</strong> <span class="tag-badge">${esc(node.parentId || 'Root')}</span></div>
        <div style="margin-top:0.5rem;"><strong>Props:</strong></div>
        <pre class="state-explorer">${esc(JSON.stringify(node.props || {}, null, 2))}</pre>
        <div style="margin-top:0.5rem;"><strong>State:</strong></div>
        <pre class="state-explorer">${esc(JSON.stringify(node.state || {}, null, 2))}</pre>
    `;
}

function renderTreeNode(node, container, depth) {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodeIds.has(node.id);
    const isSelected = node.id === selectedComponentId;

    const nodeWrapper = document.createElement('div');
    nodeWrapper.className = 'tree-node';

    const row = document.createElement('div');
    row.className = `tree-node-row${isSelected ? ' selected' : ''}`;
    row.onmouseenter = () => onNodeHover(node.id);
    row.onmouseleave = () => onNodeLeave();

    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle';
    toggleSpan.textContent = hasChildren ? (isExpanded ? '▼' : '▶') : '•';
    if (hasChildren) {
        toggleSpan.onclick = (e) => {
            e.stopPropagation();
            toggleNode(node.id);
        };
    }
    row.appendChild(toggleSpan);

    const contentSpan = document.createElement('div');
    contentSpan.style.display = 'flex';
    contentSpan.style.alignItems = 'center';
    contentSpan.style.gap = '0.5rem';
    contentSpan.style.flex = '1';
    contentSpan.onclick = () => selectComponent(node.id);

    const keyBadge = node.key !== null && node.key !== undefined
        ? `<span class="tag-badge key-badge">key="${esc(node.key)}"</span>`
        : (node.index > 0 ? `<span class="tag-badge">#${esc(node.index)}</span>` : '');

    contentSpan.innerHTML = `
        <span class="comp-name" style="font-size:0.85rem;">&lt;${esc(node.name)}&gt;</span>
        <span class="tag-badge">${esc(node.id)}</span>
        ${keyBadge}
    `;
    row.appendChild(contentSpan);
    nodeWrapper.appendChild(row);

    if (hasChildren && isExpanded) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';
        for (const child of node.children) {
            renderTreeNode(child, childrenContainer, depth + 1);
        }
        nodeWrapper.appendChild(childrenContainer);
    }

    container.appendChild(nodeWrapper);
}

function renderComponentTree(data) {
    const componentsList = document.getElementById('componentsList');
    if (!componentsList) return;
    componentsList.innerHTML = '';

    const roots = data.componentTree || [];

    if (!initialExpandDone && roots.length > 0) {
        function expandRecursively(nodes, maxDepth, currentDepth) {
            for (const n of nodes) {
                expandedNodeIds.add(n.id);
                if (n.children && currentDepth < maxDepth) {
                    expandRecursively(n.children, maxDepth, currentDepth + 1);
                }
            }
        }
        expandRecursively(roots, 3, 0);
        initialExpandDone = true;
    }

    if (roots.length > 0) {
        for (const root of roots) {
            renderTreeNode(root, componentsList, 0);
        }
    } else if (data.activeComponents && data.activeComponents.length > 0) {
        data.activeComponents.forEach((comp) => {
            const item = document.createElement('div');
            item.className = 'info-item';
            item.innerHTML = `
                <div class="info-header">
                    <span class="comp-name">&lt;${esc(comp.name)}&gt;</span>
                    <span class="tag-badge">${esc(comp.id || '-')}</span>
                </div>
                <div class="comp-details">
                    <div style="margin-top:0.25rem;"><strong>Props:</strong></div>
                    <pre class="state-explorer">${esc(JSON.stringify(comp.props, null, 2))}</pre>
                    <div style="margin-top:0.5rem;"><strong>State:</strong></div>
                    <pre class="state-explorer">${esc(JSON.stringify(comp.state, null, 2))}</pre>
                </div>
            `;
            componentsList.appendChild(item);
        });
    } else {
        componentsList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No active components in DOM.</div>';
    }
}

function renderTimeline(data) {
    const timelineList = document.getElementById('timelineList');
    if (!timelineList) return;
    timelineList.innerHTML = '';

    const items = data.timeline || [];
    if (items.length === 0) {
        timelineList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No timeline events recorded yet.</div>';
        return;
    }

    for (let i = items.length - 1; i >= 0; i--) {
        const entry = items[i];
        const isSelected = entry.id === selectedTimelineId;
        const timeStr = new Date(entry.timestamp).toLocaleTimeString();
        const typeClass = entry.type === 'mount' ? 'badge-mount' : (entry.type === 'update' ? 'badge-update' : 'badge-unmount');

        const item = document.createElement('div');
        item.className = `info-item timeline-item${isSelected ? ' selected' : ''}`;
        item.onclick = () => selectTimelineEntry(entry.id);

        let causationInfo = '';
        if (entry.causationTrace && entry.causationTrace.length > 0) {
            causationInfo = `<div style="font-size:0.75rem;color:var(--text-muted);font-family:monospace;margin-top:0.25rem;">Trace: ${esc(entry.causationTrace.join(' → '))}</div>`;
        }

        item.innerHTML = `
            <div class="info-header">
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <span class="badge ${typeClass}">${esc(entry.type)}</span>
                    <span class="comp-name">&lt;${esc(entry.componentName)}&gt;</span>
                    <span class="tag-badge">${esc(entry.componentId || '-')}</span>
                </div>
                <span style="font-size:0.75rem;color:var(--text-muted);">${esc(timeStr)}</span>
            </div>
            ${entry.key ? `<div style="font-size:0.75rem;color:var(--accent-blue);font-family:monospace;">Mutated: <strong>${esc(entry.key)}</strong></div>` : ''}
            ${causationInfo}
        `;
        timelineList.appendChild(item);
    }
}

function renderSelectedTimeline(data) {
    const container = document.getElementById('timelineDetail');
    if (!container) return;
    const items = data.timeline || [];
    const entry = items.find(e => e.id === selectedTimelineId);
    if (!entry) {
        container.innerHTML = '<div style="color:var(--text-muted);">Click a timeline event above to inspect its historical state snapshot.</div>';
        return;
    }

    const timeStr = new Date(entry.timestamp).toISOString();
    container.innerHTML = `
        <div style="margin-bottom:0.25rem;"><strong>Event:</strong> <span style="color:var(--accent-blue);font-weight:600;">${esc(entry.type.toUpperCase())}</span> on &lt;${esc(entry.componentName)}&gt; (<span class="tag-badge">${esc(entry.componentId || '-')}</span>)</div>
        <div style="margin-bottom:0.25rem;"><strong>Timestamp:</strong> <span style="font-size:0.8rem;color:var(--text-muted);">${esc(timeStr)}</span></div>
        ${entry.key ? `<div style="margin-bottom:0.25rem;"><strong>Mutated Key:</strong> <span class="tag-badge key-badge">${esc(entry.key)}</span></div>` : ''}
        ${entry.causationTrace && entry.causationTrace.length > 0 ? `<div style="margin-bottom:0.25rem;"><strong>Causation Chain:</strong> <span style="font-family:monospace;font-size:0.8rem;color:var(--accent-blue);">${esc(entry.causationTrace.join(' → '))}</span></div>` : ''}
        <div style="margin-top:0.5rem;"><strong>Captured State:</strong></div>
        <pre class="state-explorer">${esc(JSON.stringify(entry.state || {}, null, 2))}</pre>
        <div style="margin-top:0.5rem;"><strong>Captured Props:</strong></div>
        <pre class="state-explorer">${esc(JSON.stringify(entry.props || {}, null, 2))}</pre>
        <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text-muted);font-style:italic;">Note: State replay is not supported. Historical snapshot is for inspection only.</div>
    `;
}

function renderDashboard(data) {
    // 1. Render routes
    const routingList = document.getElementById('routingList');
    routingList.innerHTML = '';
    if (data.routes && Object.keys(data.routes).length > 0) {
        Object.entries(data.routes).forEach(([pattern, def]) => {
            const pageName = typeof def === 'string' ? def : def.page;
            const item = document.createElement('div');
            item.className = 'info-item';
            item.innerHTML = `
                <div class="info-header">
                    <span class="route-path">${esc(pattern)}</span>
                    <span class="route-page">${esc(pageName)}</span>
                </div>
            `;
            routingList.appendChild(item);
        });
    } else {
        routingList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No routes configured.</div>';
    }

    // 2. Render current route
    const currentRouteInfo = document.getElementById('currentRouteInfo');
    if (data.currentRoute) {
        currentRouteInfo.innerHTML = `
            <div style="margin-bottom:0.25rem;"><strong>Hash:</strong> <span style="color:var(--accent-blue);">${esc(data.currentRoute.hash)}</span></div>
            <div style="margin-bottom:0.25rem;"><strong>Page:</strong> ${esc(data.currentRoute.page)}</div>
            <div style="margin-top:0.5rem;"><strong>Params:</strong></div>
            <pre class="state-explorer">${esc(JSON.stringify(data.currentRoute.params || {}, null, 2))}</pre>
        `;
    } else {
        currentRouteInfo.innerHTML = '<div style="color:var(--text-muted);">None (App not routing or on initial load)</div>';
    }

    // 3. Render component tree & selection
    renderComponentTree(data);
    renderSelectedComponent(data);

    // 4. Render update timeline & snapshot
    renderTimeline(data);
    renderSelectedTimeline(data);

    // 5. Render bridges
    const bridgesList = document.getElementById('bridgesList');
    bridgesList.innerHTML = '';
    if (data.registeredBridges && Object.keys(data.registeredBridges).length > 0) {
        Object.entries(data.registeredBridges).forEach(([name, state]) => {
            const item = document.createElement('div');
            item.className = 'info-item';
            item.innerHTML = `
                <div class="info-header">
                    <span class="bridge-header">${esc(name)}</span>
                </div>
                <pre class="state-explorer">${esc(JSON.stringify(state, null, 2))}</pre>
            `;
            bridgesList.appendChild(item);
        });
    } else {
        bridgesList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;color:var(--text-muted);">No bridges registered.</div>';
    }
}
