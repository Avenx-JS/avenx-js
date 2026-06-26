import { AvenxErrorCodes, formatMessage } from './AvenxError.js';

/**
 * AvenxRouter handles hash-based routing for the application.
 * It maps URL hashes to specific Page components.
 */
export class AvenxRouter {
    /**
     * @param {AvenxApp} app - The main application instance.
     * @param {Object<string, string|Object>} routes - A map of hash routes to page names or route definitions.
     */
    constructor(app, routes = {}) {
        /** @type {AvenxApp} */
        this.app = app;
        /** @type {Object<string, string|Object>} */
        this.routes = routes;
        /** @type {Object|null} */
        this.currentRoute = null;
        /** @type {string|null} @private */
        this.hashToIgnore = null;

        this.hashChangeHandler = () => this.#handleRoute();
        window.addEventListener('hashchange', this.hashChangeHandler);
    }

    /**
     * Starts the router and handles the initial route.
     */
    start() {
        this.#handleRoute();
    }

    /**
     * Navigates to a specific hash route.
     * @param {string} hash - The target hash (e.g., '#/about').
     */
    navigate(hash) {
        window.location.hash = hash;
    }

    /**
     * Destroys the router and cleans up event listeners.
     */
    destroy() {
        window.removeEventListener('hashchange', this.hashChangeHandler);
    }

    /**
     * Sequentially executes an array of guards for a route transition.
     * @param {Array<typeof AvenxGuard|AvenxGuard>} guards - Route guards.
     * @param {Object} to - Target route details.
     * @param {Object|null} from - Current route details.
     * @returns {Promise<boolean|string>} Result of the guard checks (true, false, or redirect path).
     * @private
     */
    #runGuards(guards, to, from) {
        return new Promise((resolve) => {
            const nextGuard = (index) => {
                if (index >= guards.length) {
                    resolve(true);
                    return;
                }
                const Guard = guards[index];
                const instance = typeof Guard === 'function' ? new Guard() : Guard;

                Promise.resolve(instance.canActivate(to, from))
                    .then(result => {
                        if (result === false || typeof result === 'string') {
                            resolve(result);
                        } else {
                            nextGuard(index + 1);
                        }
                    })
                    .catch(err => {
                        console.error(formatMessage(AvenxErrorCodes.ROUTER_GUARD_ERROR, to.hash, err));
                        resolve(false);
                    });
            };
            nextGuard(0);
        });
    }

    /**
     * Handles the current route by matching it against patterns, executing guards,
     * and mounting the corresponding page.
     * @private
     */
    #handleRoute() {
        let hash = window.location.hash || '#/';

        // Strip any secondary anchor (e.g. #/profile#details)
        const secondHashIndex = hash.indexOf('#', 1);

        if (secondHashIndex !== -1) {
            hash = hash.substring(0, secondHashIndex);
        }

        if (this.hashToIgnore === hash) {
            this.hashToIgnore = null;
            return;
        }

        let matchedRoute = null;
        let params = {};

        for (const [routePattern, routeDef] of Object.entries(this.routes)) {
            if (routePattern === '*') continue;

            const paramNames = [];
            const regexStr = routePattern
                .replace(/[.*+^${}()|[\]\\]/g, '\\$&')
                .replace(/:([a-zA-Z0-9_$]+)/g, (_, name) => {
                    paramNames.push(name);
                    return '([^/]+)';
                });
            const regex = new RegExp(`^${regexStr}$`);

            const [pathPart, queryPart] = hash.split('?');
            const match = pathPart.match(regex);

            if (match) {
                matchedRoute = { pattern: routePattern, definition: routeDef };
                paramNames.forEach((name, idx) => {
                    const value = match[idx + 1];

                    try {
                        params[name] = decodeURIComponent(value);
                    } catch {
                        console.warn(
                            `[AvenxRouter] Failed to decode route parameter "${name}": ${value}`
                        );

                        params[name] = value;
                    }
                });
                if (queryPart) {
                    const queryParams = new URLSearchParams(queryPart);
                    params.query = Object.fromEntries(queryParams.entries());
                }
                break;
            }
        }

        // Fallback to '*' if no route matched
        if (!matchedRoute && this.routes['*']) {
            matchedRoute = { pattern: '*', definition: this.routes['*'] };
        }

        if (!matchedRoute) {
            console.warn(`[AvenxRouter] No route defined for hash: ${hash}`);
            return;
        }

        const def = matchedRoute.definition;
        const pageName = typeof def === 'string' ? def : def.page;
        const guards = typeof def === 'object' ? (def.guards || []) : [];

        const to = { hash, page: pageName, params };
        const from = this.currentRoute;

        this.#runGuards(guards, to, from).then(result => {
            if (result === false) {
                console.warn(formatMessage(AvenxErrorCodes.ROUTER_GUARD_DENIED, to.hash));
                if (from && from.hash !== window.location.hash) {
                    this.hashToIgnore = from.hash;
                    window.location.hash = from.hash;
                }
            } else if (typeof result === 'string') {
                this.navigate(result);
            } else {
                this.currentRoute = to;
                this.app.mountPage(pageName, params);
            }
        });
    }
}
