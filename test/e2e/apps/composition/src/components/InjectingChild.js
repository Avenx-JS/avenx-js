import ChildView from './child-view/child-view.component.js';

export default class InjectingChild extends ChildView {
  static inject = ['theme'];
}
