export const app = document.querySelector('main')!;
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = app) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}
element('h1', 'StoryCursor');
const status = element('p');
status.setAttribute('role', 'status');
export function report(message: string) { status.textContent = message; }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Unexpected error.'; }
export function action(label: string, run: () => Promise<void>, parent = app) {
  const button = element('button', label, parent);
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (app.dataset.busy) return;
    app.dataset.busy = 'true';
    button.disabled = true;
    try { await run(); } catch (error) { report(errorMessage(error)); }
    finally { button.disabled = false; delete app.dataset.busy; }
  });
  return button;
}
export function input(label: string, parent = app, value = '', type = 'text') {
  const field = element('input', '', element('label', label, parent));
  field.type = type;
  field.value = value;
  field.maxLength = 2000;
  return field;
}
export function details(label: string) {
  const panel = element('details');
  element('summary', label, panel);
  return panel;
}
