// Global toast notification helper.
// Usage: showToast('Saved successfully!', 'success')
//        showToast('Something went wrong.', 'error')
(function () {
  function ensureContainer() {
    let c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  window.showToast = function (message, type = 'info', duration = 4000) {
    const container = ensureContainer();
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ️';
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity .25s, transform .25s';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  };

  // Auto-convert any server-rendered flash alerts into toasts too, so both
  // full-page-reload flows (req.flash) and AJAX flows feel consistent.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.alert-success').forEach(el => showToast(el.textContent.replace('✓', '').trim(), 'success'));
    document.querySelectorAll('.alert-error').forEach(el => showToast(el.textContent.replace('✕', '').trim(), 'error'));
  });
})();
