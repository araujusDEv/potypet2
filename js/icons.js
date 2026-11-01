/* Ícones vetoriais locais: nenhum emoji, fonte de ícones ou serviço externo. */
const APPET_ICONS = Object.freeze({
  paw: '<ellipse cx="5.2" cy="8" rx="2" ry="2.8" transform="rotate(-24 5.2 8)"/><ellipse cx="10" cy="4.8" rx="2" ry="2.8"/><ellipse cx="15.2" cy="5.2" rx="2" ry="2.8" transform="rotate(12 15.2 5.2)"/><ellipse cx="19.4" cy="9.1" rx="2" ry="2.8" transform="rotate(28 19.4 9.1)"/><path d="M5.5 17.3c0-2.1 2.2-3 3.3-5 1.3-2.3 4.7-2.3 6 0 1.1 2 3.7 3.4 3.7 5.5 0 2-1.5 3.2-3.3 3.2-1.2 0-2.1-.8-3.5-.8s-2.3.8-3.4.8c-1.8 0-2.8-1.5-2.8-3.7Z"/>',
  heart:
    '<path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>',
  shield: '<path d="M12 3c-3 2-5.5 2.8-9 3v6c0 5 3.6 8 9 10 5.4-2 9-5 9-10V6c-3.5-.2-6-1-9-3Z"/>',
  'shield-check':
    '<path d="M12 3c-3 2-5.5 2.8-9 3v6c0 5 3.6 8 9 10 5.4-2 9-5 9-10V6c-3.5-.2-6-1-9-3Z"/><path d="m8 12 3 3 5-6"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
  users:
    '<path d="M3 21v-3a6 6 0 0 1 12 0v3M17 13a6 6 0 0 1 4 5v3"/><circle cx="9" cy="6" r="4"/><path d="M17 2a4 4 0 0 1 0 8"/>',
  menu: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 3v18M3 12h18"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>',
  moon: '<path d="M20.5 13a9 9 0 0 1-9.5-9.5A9 9 0 1 0 20.5 13Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  'arrow-up-right': '<path d="M7 17 20 4M9 4h11v11M13 3H4v17h17v-9"/>',
  clipboard:
    '<rect x="4" y="5" width="16" height="17" rx="2"/><rect x="8" y="2" width="8" height="5" rx="1.5"/><path d="M8 12h8M8 16h8"/>',
  logout: '<path d="M9 3H4v18h5M9 12h12m-5-5 5 5-5 5"/>',
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  star: '<path d="m12 2 3 6.1 6.8 1-4.9 4.8 1.2 6.8L12 17.5l-6.1 3.2 1.2-6.8L2.2 9.1l6.8-1Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  house: '<path d="m2 10 10-8 10 8M5 8v13h14V8M9 21v-8h6v8"/>',
  message: '<path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.8L3 21l1.8-5A9 9 0 1 1 21 11Z"/>',
  book: '<path d="M12 5v16M12 5C8 2 4 2 2 3v16c3-1 6-1 10 2 4-3 7-3 10-2V3c-2-1-6-1-10 2Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V21h-4v-.1A1.8 1.8 0 0 0 8.8 19a1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2A1.8 1.8 0 0 0 2.7 13H2V9h.7a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.4-2l-.1-.1L6.7 3l.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 10 1.8V1h4v.8a1.8 1.8 0 0 0 1.1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1L20 5.8l-.1.1a1.8 1.8 0 0 0-.4 2A1.8 1.8 0 0 0 21.2 9h.8v4h-.8a1.8 1.8 0 0 0-1.8 2Z"/>',
  sparkles:
    '<path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 12l.8 2.2L22 15l-2.2.8L19 18l-.8-2.2L16 15l2.2-.8L19 12Z"/>',
  'panel-left':
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 9l-3 3 3 3"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="m3 3 18 18M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.2 2.8M6.6 6.6C3.6 8.4 2 12 2 12s3.5 6 10 6a11 11 0 0 0 4-.7M10.7 10.7a2 2 0 0 0 2.6 2.6"/>',
});

function svgIcon(name, className = '') {
  const classes = String(className).replace(/[^a-zA-Z0-9 _-]/g, '');
  return `<svg class="icon ${classes}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${APPET_ICONS[name] || APPET_ICONS.circle}</svg>`;
}

function renderStaticIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = svgIcon(el.dataset.icon);
  });
}

document.addEventListener('DOMContentLoaded', () => renderStaticIcons());
