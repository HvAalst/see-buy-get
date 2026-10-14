// Tiny DOM helper for the WS-UX kit. Builds elements without innerHTML (no XSS),
// so all component text is set via textContent.
//
// el('button', { className: 'btn', onClick, attrs: { 'aria-label': 'x' } }, 'Label')

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, onClick, attrs, dataset, style } = options;

  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  if (onClick) node.addEventListener('click', onClick);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value != null && value !== false) node.setAttribute(key, String(value));
    }
  }
  if (dataset) {
    for (const [key, value] of Object.entries(dataset)) node.dataset[key] = String(value);
  }
  if (style) {
    for (const [key, value] of Object.entries(style)) node.style[key] = value;
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Mount a node (or array of nodes) into a container, clearing it first.
export function mount(container, content) {
  container.replaceChildren(...(Array.isArray(content) ? content : [content]));
  return container;
}
