import GrandchildView from './grandchild-view/grandchild-view.component.js';

export default class InjectingGrandchild extends GrandchildView {
  static inject = ['theme'];
}
