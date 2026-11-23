(function () {
    if (window.__avenxDevOverlay) return;

    var OVERLAY_ID = '__avenx-error-overlay';
    var MAX_DIAGNOSTICS = 50;
    var shown = [];
    var dismissed = false;

    // Diagnostic text is compiler output, and compiler output quotes the
    // developer's own source: angle brackets, quotes and a code frame full of
    // template markup. It is written into the document, so every piece of it
    // is escaped first -- an overlay that renders the broken template as
    // markup would be a script-execution sink on the dev server's origin.
    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Every declaration is marked important. An important declaration in a
    // style attribute outranks any author rule, important ones included, so
    // the application cannot restyle or hide the overlay -- which matters
    // most when the application's own stylesheet is what failed to build.
    function css(declarations) {
        return declarations.join(' !important;') + ' !important;';
    }

    var CONTAINER_BLOCKING = css([
        'position: fixed',
        'top: 0',
        'right: 0',
        'bottom: 0',
        'left: 0',
        'z-index: 2147483647',
        'display: flex',
        'visibility: visible',
        'opacity: 1',
        'align-items: flex-start',
        'justify-content: center',
        'box-sizing: border-box',
        'padding: 24px',
        'overflow: auto',
        'background: rgba(9, 9, 11, 0.88)',
        'pointer-events: auto',
        'transform: none',
        'margin: 0'
    ]);

    // Warnings never take the page away from the developer: the container
    // tucks itself into a corner and passes clicks through, and only the panel
    // itself is interactive.
    var CONTAINER_PASSIVE = css([
        'position: fixed',
        'right: 16px',
        'bottom: 16px',
        'left: auto',
        'top: auto',
        'z-index: 2147483647',
        'display: block',
        'visibility: visible',
        'opacity: 1',
        'box-sizing: border-box',
        'width: min(520px, calc(100vw - 32px))',
        'max-height: calc(100vh - 32px)',
        'overflow: auto',
        'background: transparent',
        'pointer-events: none',
        'transform: none',
        'margin: 0'
    ]);

    var PANEL = css([
        'box-sizing: border-box',
        'width: 100%',
        'max-width: 920px',
        'margin: 0',
        'padding: 0',
        'border: 1px solid #27272a',
        'border-radius: 8px',
        'background: #09090b',
        'color: #f4f4f5',
        'box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55)',
        'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        'font-size: 13px',
        'font-weight: 400',
        'line-height: 1.55',
        'text-align: left',
        'letter-spacing: normal',
        'pointer-events: auto'
    ]);

    var HEADER = css([
        'display: flex',
        'align-items: center',
        'justify-content: space-between',
        'gap: 12px',
        'box-sizing: border-box',
        'margin: 0',
        'padding: 12px 16px',
        'border-bottom: 1px solid #27272a',
        'background: #18181b',
        'border-radius: 8px 8px 0 0'
    ]);

    var BODY = css([
        'box-sizing: border-box',
        'margin: 0',
        'padding: 16px',
        'max-height: 60vh',
        'overflow: auto'
    ]);

    var FOOTER = css([
        'box-sizing: border-box',
        'margin: 0',
        'padding: 10px 16px',
        'border-top: 1px solid #27272a',
        'color: #a1a1aa',
        'font-size: 12px'
    ]);

    var DISMISS = css([
        'flex: 0 0 auto',
        'box-sizing: border-box',
        'margin: 0',
        'padding: 4px 10px',
        'border: 1px solid #3f3f46',
        'border-radius: 4px',
        'background: #27272a',
        'color: #f4f4f5',
        'font: inherit',
        'font-size: 12px',
        'line-height: 1.4',
        'cursor: pointer',
        'pointer-events: auto'
    ]);

    var FRAME = css([
        'display: block',
        'box-sizing: border-box',
        'margin: 10px 0 0 0',
        'padding: 10px 12px',
        'border: 1px solid #27272a',
        'border-radius: 4px',
        'background: #09090b',
        'color: #e4e4e7',
        'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        'font-size: 12px',
        'line-height: 1.5',
        'white-space: pre',
        'overflow-x: auto',
        'tab-size: 2'
    ]);

    function isError(diagnostic) {
        return Boolean(diagnostic) && diagnostic.severity === 'error';
    }

    function locationOf(diagnostic) {
        var where = diagnostic.file || 'unknown source';
        if (typeof diagnostic.line === 'number') {
            where += ':' + diagnostic.line;
            if (typeof diagnostic.column === 'number') where += ':' + diagnostic.column;
        }
        return where;
    }

    function cardHtml(diagnostic) {
        var fatal = isError(diagnostic);
        var accent = fatal ? '#f87171' : '#fbbf24';
        var code = diagnostic.code || 'AVX_UNK';
        var card = css([
            'box-sizing: border-box',
            'margin: 0 0 12px 0',
            'padding: 12px 14px',
            'border: 1px solid #27272a',
            'border-left: 4px solid ' + accent,
            'border-radius: 6px',
            'background: #18181b',
            'color: #f4f4f5'
        ]);
        var badge = css([
            'display: inline-block',
            'margin: 0 8px 0 0',
            'padding: 1px 7px',
            'border-radius: 3px',
            'background: ' + accent,
            'color: #09090b',
            'font-size: 11px',
            'font-weight: 700',
            'text-transform: uppercase',
            'letter-spacing: 0.06em'
        ]);
        var meta = css([
            'margin: 6px 0 0 0',
            'padding: 0',
            'color: #a1a1aa',
            'font-size: 12px'
        ]);
        var text = css([
            'margin: 8px 0 0 0',
            'padding: 0',
            'color: #f4f4f5',
            'white-space: pre-wrap',
            'word-break: break-word',
            'font-family: inherit',
            'font-size: 13px'
        ]);

        var html = '<div style="' + card + '">'
            + '<div><span style="' + badge + '">' + esc(fatal ? 'error' : 'warning') + '</span>'
            + '<span style="' + css(['color: ' + accent, 'font-weight: 700']) + '">' + esc(code) + '</span></div>'
            + '<div style="' + meta + '">' + esc(locationOf(diagnostic)) + '</div>'
            + '<div style="' + text + '">' + esc(diagnostic.message || 'No message.') + '</div>';

        if (diagnostic.frame) {
            html += '<pre style="' + FRAME + '">' + esc(diagnostic.frame) + '</pre>';
        }

        return html + '</div>';
    }

    function isRuntime(diagnostic) {
        return Boolean(diagnostic) && diagnostic.runtime === true;
    }

    function summarise(list) {
        var errors = list.filter(isError).length;
        var warnings = list.length - errors;
        var parts = [];
        if (errors) parts.push(errors + (errors === 1 ? ' error' : ' errors'));
        if (warnings) parts.push(warnings + (warnings === 1 ? ' warning' : ' warnings'));
        var headline = 'Build warnings';
        if (errors) headline = list.every(isRuntime) ? 'Runtime error' : 'Build failed';
        return headline + ' · ' + parts.join(', ');
    }

    function panelHtml(list) {
        // Only a real diagnostic code is worth offering to avenx explain; the
        // placeholder the parser falls back to, and the labels on runtime
        // failures, would send the developer to a command that has nothing to
        // say about them.
        var explainable = null;
        for (var i = 0; i < list.length && !explainable; i++) {
            var code = list[i] && list[i].code;
            if (code && code.indexOf('AVX_') === 0 && code !== 'AVX_UNK') explainable = code;
        }
        var hint;
        if (explainable) {
            hint = 'Run "avenx explain ' + explainable + '" for the full explanation.';
        } else if (list.every(isRuntime)) {
            hint = 'The browser console has the full stack.';
        } else {
            hint = 'Run "avenx check" for the full report.';
        }

        var cards = '';
        for (var j = 0; j < list.length; j++) cards += cardHtml(list[j]);

        return '<div style="' + PANEL + '">'
            + '<div style="' + HEADER + '">'
            + '<strong style="' + css(['margin: 0', 'font-size: 13px', 'font-weight: 700', 'color: #f4f4f5']) + '">'
            + esc(summarise(list)) + '</strong>'
            + '<button type="button" data-avenx-dismiss aria-label="Dismiss the Avenx build overlay" style="' + DISMISS + '">Dismiss</button>'
            + '</div>'
            + '<div style="' + BODY + '">' + cards + '</div>'
            + '<div style="' + FOOTER + '">' + esc(hint) + ' This overlay comes from the Avenx dev server and is never part of a build.</div>'
            + '</div>';
    }

    function remove() {
        var existing = document.getElementById(OVERLAY_ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function draw() {
        remove();
        if (dismissed || shown.length === 0) return;
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', draw, { once: true });
            return;
        }

        var blocking = shown.some(isError);
        var overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('role', blocking ? 'alertdialog' : 'status');
        overlay.setAttribute('aria-live', blocking ? 'assertive' : 'polite');
        overlay.setAttribute('data-avenx-blocking', blocking ? 'true' : 'false');
        overlay.style.cssText = blocking ? CONTAINER_BLOCKING : CONTAINER_PASSIVE;
        overlay.innerHTML = panelHtml(shown);
        document.body.appendChild(overlay);

        var dismiss = overlay.querySelector('[data-avenx-dismiss]');
        if (dismiss) {
            dismiss.addEventListener('click', function () {
                dismissed = true;
                remove();
            });
        }
    }

    // The diagnostics of one build pass, replacing whatever was on screen.
    // An empty list is how a successful rebuild clears the overlay.
    function render(diagnostics) {
        shown = (Array.isArray(diagnostics) ? diagnostics : [])
            .filter(Boolean)
            .slice(0, MAX_DIAGNOSTICS);
        dismissed = false;
        draw();
    }

    function clear() {
        shown = [];
        dismissed = false;
        remove();
    }

    // A runtime failure joins the same overlay. It is additive rather than
    // replacing, because the build diagnostics are still true; the next build
    // pass drops it, since render() replaces the whole list.
    function report(diagnostic) {
        if (!diagnostic) return;
        var key = [diagnostic.code, diagnostic.file, diagnostic.line, diagnostic.message].join('|');
        for (var i = 0; i < shown.length; i++) {
            if (shown[i].__avenxKey === key) return;
        }
        diagnostic.__avenxKey = key;
        shown = shown.concat([diagnostic]).slice(0, MAX_DIAGNOSTICS);
        dismissed = false;
        draw();
    }

    document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (!document.getElementById(OVERLAY_ID)) return;
        dismissed = true;
        remove();
    });

    // A script URL on this origin is shown the way the project refers to it.
    function shortenUrl(url) {
        if (typeof url !== 'string' || url === '') return null;
        var origin = window.location.origin;
        return url.indexOf(origin + '/') === 0 ? url.slice(origin.length + 1) : url;
    }

    window.addEventListener('error', function (event) {
        var error = event && event.error;
        report({
            severity: 'error',
            runtime: true,
            code: 'Uncaught',
            file: shortenUrl(event && event.filename),
            line: event && typeof event.lineno === 'number' ? event.lineno : undefined,
            column: event && typeof event.colno === 'number' ? event.colno : undefined,
            message: (error && error.message) || (event && event.message) || 'Uncaught error',
            frame: (error && error.stack) || null
        });
    });

    window.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason;
        report({
            severity: 'error',
            runtime: true,
            code: 'Unhandled rejection',
            file: null,
            message: (reason && reason.message)
                || (typeof reason === 'string' ? reason : 'A promise rejected with no reason.'),
            frame: (reason && reason.stack) || null
        });
    });

    window.__avenxDevOverlay = { render: render, clear: clear, report: report };
})();
