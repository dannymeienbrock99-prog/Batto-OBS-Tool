"use strict";

(() => {
  function removeById(id) {
    const node = document.getElementById(id);
    if (!node) return;
    const wrapper = node.closest("label, .cs-toggle, article, section, .panel") || node;
    wrapper.remove();
  }

  function clean() {
    for (const id of ["cs-diagnostics", "cs-overlay-monitor"]) removeById(id);

    document.querySelectorAll("[data-cs-page='overlays'] .cs-toggle").forEach((node) => {
      if (/Monitoring/i.test(node.textContent || "")) node.remove();
    });

    document.querySelectorAll(".nav-button").forEach((button) => {
      if (["hardware", "internet", "recommendation", "loadtest", "monitoring"].includes(button.dataset.view)) button.remove();
    });

    for (const name of ["hardware", "internet", "recommendation", "loadtest", "monitoring"]) {
      document.getElementById(`view-${name}`)?.remove();
    }
  }

  clean();
  const observer = new MutationObserver(clean);
  observer.observe(document.body, { childList: true, subtree: true });
})();
