import { WidgetType, Decoration } from '@codemirror/view';

export class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-hr-widget';
    return el;
  }
  eq() { return true; }
}

export const hrDecoration = Decoration.replace({ widget: new HrWidget() });
