/**
 * Handles patching the DOM with new HTML content using a simple diffing algorithm.
 * This approach is more efficient than innerHTML as it preserves existing DOM nodes.
 */
export class DomPatcher {
    /**
     * Patches the target element with the provided HTML.
     * @param {Element} target - The element to patch.
     * @param {string} html - The new HTML content.
     */
    patch(target, html) {
        const parser = new DOMParser();
        const newDoc = parser.parseFromString(html, 'text/html');
        const newRoot = newDoc.body;

        this.#patchNode(target, newRoot);
    }

    /**
     * Recursively diffs and patches two nodes.
     * @param {Node} oldNode - The existing DOM node.
     * @param {Node} newNode - The new node structure.
     * @private
     */
    #patchNode(oldNode, newNode) {
        // 1. Update attributes if it's an element
        if (oldNode.nodeType === Node.ELEMENT_NODE && newNode.nodeType === Node.ELEMENT_NODE) {
            this.#patchAttributes(oldNode, newNode);
        }

        // 2. Diff children
        const oldChildren = Array.from(oldNode.childNodes);
        const newChildren = Array.from(newNode.childNodes);

        let oldIndex = 0;
        let newIndex = 0;

        while (newIndex < newChildren.length) {
            const newChild = newChildren[newIndex];
            let oldChild = oldChildren[oldIndex];

            // Skip items managed by ListManager in the old DOM
            while (oldChild && oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item')) {
                oldIndex++;
                oldChild = oldChildren[oldIndex];
            }

            if (!oldChild) {
                // Add remaining new children
                oldNode.appendChild(newChild.cloneNode(true));
            } else if (this.#isSameNodeType(oldChild, newChild)) {
                // Nodes are same type, patch them
                if (oldChild.nodeType === Node.TEXT_NODE) {
                    if (oldChild.textContent !== newChild.textContent) {
                        oldChild.textContent = newChild.textContent;
                    }
                } else {
                    this.#patchNode(oldChild, newChild);
                }
                oldIndex++;
            } else {
                // Nodes are different, replace
                oldNode.replaceChild(newChild.cloneNode(true), oldChild);
                oldIndex++;
            }
            newIndex++;
        }

        // Remove remaining old children (that are not managed by ListManager)
        while (oldIndex < oldChildren.length) {
            const oldChild = oldChildren[oldIndex];
            if (!(oldChild.nodeType === Node.ELEMENT_NODE && oldChild.hasAttribute('data-ax-list-item'))) {
                oldNode.removeChild(oldChild);
            }
            oldIndex++;
        }
    }

    /**
     * Checks if two nodes are of the same type and name.
     * @private
     */
    #isSameNodeType(nodeA, nodeB) {
        return nodeA.nodeType === nodeB.nodeType && nodeA.nodeName === nodeB.nodeName;
    }

    /**
     * Syncs attributes from newNode to oldNode.
     * @private
     */
    #patchAttributes(oldNode, newNode) {
        const oldAttrs = oldNode.attributes;
        const newAttrs = newNode.attributes;

        // Remove old attributes that are gone
        for (let i = oldAttrs.length - 1; i >= 0; i--) {
            const attr = oldAttrs[i];
            if (!newNode.hasAttribute(attr.name)) {
                oldNode.removeAttribute(attr.name);
            }
        }

        // Add or update attributes
        for (let i = 0; i < newAttrs.length; i++) {
            const attr = newAttrs[i];
            if (oldNode.getAttribute(attr.name) !== attr.value) {
                oldNode.setAttribute(attr.name, attr.value);
            }
        }
    }
}
