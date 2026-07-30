/* Vanilla PWA registration + prompt-mode update nudge. Drop in via:
     <script src="pwa-register.js" defer></script>
   Pairs with sw.js + manifest.json. Self-contained, no dependencies. Safe no-op where
   service workers are unavailable (file://, plain http, older browsers). */
(function () {
  if (!("serviceWorker" in navigator)) return;

  function boot() {
    let awaitingReload = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (awaitingReload) location.reload();          // the new worker took over → one clean reload
    });
    function nudge(worker) {
      if (worker) showUpdateToast(function () {
        awaitingReload = true;
        worker.postMessage({ type: "SKIP_WAITING" }); // ask the waiting worker to activate now
      });
    }
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) nudge(reg.waiting);  // update staged on a past visit
      reg.addEventListener("updatefound", function () {
        var fresh = reg.installing;
        if (fresh) fresh.addEventListener("statechange", function () {
          if (fresh.state === "installed" && navigator.serviceWorker.controller) nudge(fresh);
        });
      });
    }).catch(function () {});
  }

  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);

  /* "New version ready" toast — pure DOM (works before any app UI is up), fixed bottom,
     ≥44px tap target, safe-area aware, guarded against duplicates. onRefresh applies the
     waiting worker + reloads.  CUSTOMIZE the label text, colors, and font below. */
  function showUpdateToast(onRefresh) {
    if (document.getElementById("pwa-update-toast")) return;
    var bar = document.createElement("div");
    bar.id = "pwa-update-toast";
    bar.style.cssText =
      "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483647;" +
      "display:flex;align-items:center;gap:12px;padding:11px 12px 11px 16px;border-radius:16px;max-width:calc(100vw - 24px);box-sizing:border-box;" +
      "background:rgba(20,24,34,0.98);color:#f4f6ff;border:1px solid rgba(255,255,255,0.10);box-shadow:0 12px 36px rgba(0,0,0,0.6);" +
      "font:700 14px/1.3 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.2px";
    var label = document.createElement("span");
    label.textContent = "New version ready";          /* CUSTOMIZE */
    var btn = document.createElement("button");
    btn.textContent = "REFRESH";                       /* CUSTOMIZE */
    btn.style.cssText =
      "appearance:none;border:0;cursor:pointer;flex:none;padding:10px 18px;border-radius:12px;min-height:44px;" +
      "background:#4aa3ff;color:#04121f;font:800 14px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.4px";
    btn.addEventListener("pointerdown", function (e) { e.stopPropagation(); });  // don't leak the tap through
    btn.addEventListener("click", function () { bar.remove(); onRefresh(); });
    bar.append(label, btn);
    document.body.appendChild(bar);
  }
})();
