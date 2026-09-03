const navigationItems = [
    ['/', '▦', 'Attendance'],
    ['/history.html', '◷', 'Call history'],
    ['/analytics.html', '⌁', 'Insights'],
    ['/docs.html', '?', 'Docs'],
    ['/status.html', '◉', 'Status'],
    ['/settings.html', '⚙', 'Settings']
];

function renderNavigation() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const currentPath = window.location.pathname.replace(/\\/$ /, '') || '/';
    sidebar.innerHTML = `<div class="brand"><span class="brand-mark">✦</span><span>attendly</span></div><p class="eyebrow">Classroom tools</p><nav aria-label="Primary navigation">${navigationItems.map(([href, icon, label]) => `<a${href === currentPath ? ' class="active" aria-current="page"' : ''} href="${href}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('')}</nav><div class="sidebar-foot"><div class="avatar">SV</div><div><strong>Shivaprasad V</strong><small>Class teacher</small></div><span class="more" aria-hidden="true">•••</span></div>`;
}

renderNavigation();
