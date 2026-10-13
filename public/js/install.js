// "Install the app" button: Chrome/Android uses beforeinstallprompt, iPhone/iPad Safari gets a short guide.
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function isIosSafari() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram/.test(ua);
}

export function setupInstall() {
  const box = document.getElementById("install");
  const button = document.getElementById("install-btn");
  const guide = document.getElementById("ios-guide");
  const close = document.getElementById("ios-close");
  if (!box || !button || !guide) return;

  let deferred = null;
  const hide = () => {
    box.hidden = true;
    guide.hidden = true;
  };
  const toggleGuide = (open) => {
    guide.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };

  if (isStandalone()) return hide();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    button.removeAttribute("aria-expanded");
    box.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    hide();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", (e) => e.matches && hide());

  if (isIosSafari()) {
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "ios-guide");
    box.hidden = false;
  }

  button.addEventListener("click", async () => {
    if (deferred) {
      const prompt = deferred;
      deferred = null;
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice?.outcome === "accepted") return hide();
      } catch (err) {
        console.warn("Install prompt unavailable:", err);
      }
      box.hidden = true;
      return;
    }
    toggleGuide(guide.hidden);
  });
  close?.addEventListener("click", () => {
    toggleGuide(false);
    button.focus();
  });
}
