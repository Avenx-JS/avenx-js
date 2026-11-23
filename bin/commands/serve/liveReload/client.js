if ('EventSource' in window) {
    const source = new EventSource('/__avenx_live_reload__');
    let pendingStylesheet = null;
    let stylesheetSwapToken = 0;
    const swapStylesheet = () => {
        const current = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .find((link) => new URL(link.href, document.baseURI).pathname.endsWith('/bundle.css'));
        if (!current) return;

        if (pendingStylesheet && pendingStylesheet.parentNode) {
            pendingStylesheet.parentNode.removeChild(pendingStylesheet);
        }

        const replacement = document.createElement('link');
        replacement.rel = 'stylesheet';
        const url = new URL(current.href, document.baseURI);
        url.searchParams.set('t', String(Date.now()));
        replacement.href = url.href;
        const token = ++stylesheetSwapToken;
        pendingStylesheet = replacement;
        replacement.onload = () => {
            if (token !== stylesheetSwapToken) return;
            if (current.parentNode) current.parentNode.removeChild(current);
            pendingStylesheet = null;
        };
        replacement.onerror = () => {
            if (replacement.parentNode) replacement.parentNode.removeChild(replacement);
            if (token === stylesheetSwapToken) pendingStylesheet = null;
        };
        current.parentNode.insertBefore(replacement, current.nextSibling);
    };
    // Messages are JSON objects carrying a type, and a bare string is
    // still understood so an older payload shape cannot break reloading.
    const parseMessage = (data) => {
        if (typeof data !== 'string') return { type: '' };
        if (data.charAt(0) !== '{') return { type: data };
        try {
            const parsed = JSON.parse(data);
            return parsed && typeof parsed === 'object' ? parsed : { type: '' };
        } catch {
            return { type: data };
        }
    };
    source.onmessage = (e) => {
        const message = parseMessage(e.data);
        const diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];

        if (message.type === 'error' || message.type === 'ok') {
            // Absent when the overlay is switched off; the reload
            // behaviour below is unaffected either way.
            if (window.__avenxDevOverlay) {
                window.__avenxDevOverlay.render(diagnostics);
            }
            return;
        }
        if (message.type === 'reload') {
            window.location.reload();
        } else if (message.type === 'css') {
            swapStylesheet();
        }
    };
}
