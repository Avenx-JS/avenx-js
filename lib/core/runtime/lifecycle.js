/**
 * Manages the lifecycle of Avenx components.
 */
export class LifecycleManager {
  /**
   * Mounts a component to a target element and performs the initial update.
   * @param {AvenxComponent} component - The component instance to mount.
   * @param {Element|string} target - The target DOM element or selector.
   */
  mount(component, target) {
    const targetEl = typeof target === 'string' ? document.querySelector(target) : target;
    component.__setMountTarget(targetEl);
    component.update();
    if (component.__afterMount) {
      component.__afterMount();
    }
  }
}
