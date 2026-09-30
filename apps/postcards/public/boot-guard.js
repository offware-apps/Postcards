// Boot guard: a classic script that runs before the app's module entry. When the
// entry or one of its static imports fails to download, the module graph never
// runs and the page would stay blank; this shows the same "did not load —
// reload" message ui/LoadFailure shows (its strings are loadFailure.* in
// src/lib/i18n). main.tsx calls __postcardsBootGuard.cancel() as soon as it runs,
// which removes the message if it is up and disarms the guard, so a boot that
// is only slow never sees it after that point.
(function () {
  var TEXT = {
    en: {
      text: "Part of Postcards did not load, often because the connection dropped. Your places are safe on this device.",
      reload: "Reload",
      title: "Reload Postcards and try again",
    },
    fr: {
      text: "Une partie de Postcards ne s'est pas chargée, souvent parce que la connexion a été coupée. Vos lieux sont en sécurité sur cet appareil.",
      reload: "Recharger",
      title: "Recharger Postcards et réessayer",
    },
    ko: {
      text: "Postcards의 일부를 불러오지 못했습니다. 대개 연결이 끊겼기 때문입니다. 장소는 이 기기에 안전하게 저장되어 있습니다.",
      reload: "새로고침",
      title: "Postcards를 새로고침하고 다시 시도",
    },
  };
  // Long enough that a slow connection still delivers the entry first; a failed
  // download shows sooner, through the error listener below.
  var TIMEOUT_MS = 30000;
  var armed = true;
  var shown = null;

  // The saved choice, else the browser's languages, as src/lib/i18n/core does.
  function locale() {
    try {
      var saved = localStorage.getItem("postcards-locale");
      if (TEXT[saved]) return saved;
    } catch (e) {}
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; i < langs.length; i++) {
      var base = String(langs[i] || "").toLowerCase().split("-")[0];
      if (base === "fr" || base === "ko") return base;
    }
    return "en";
  }

  function show() {
    if (!armed || shown) return;
    // A failure can land while the head is still parsing.
    if (!document.body) return void document.addEventListener("DOMContentLoaded", show);
    var s = TEXT[locale()];
    shown = document.createElement("div");
    shown.id = "boot-failure";
    shown.className = "load-failure";
    shown.setAttribute("role", "alert");
    var p = document.createElement("p");
    p.textContent = s.text;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.title = s.title;
    b.textContent = s.reload;
    b.addEventListener("click", function () {
      location.reload();
    });
    shown.appendChild(p);
    shown.appendChild(b);
    // Into the app's own container, empty while the app has not run; the page
    // locks body scrolling and gives #root the full height.
    (document.getElementById("root") || document.body).appendChild(shown);
  }

  // The entry script, or a module it imports (modulepreloaded), that fails to
  // load fires "error" on its element, which does not bubble; a capturing
  // listener on window sees it. A failed stylesheet or fetch preload does not
  // stop the app from running, so it does not count.
  window.addEventListener(
    "error",
    function (e) {
      var el = e.target;
      if (!el) return;
      if (el.tagName === "SCRIPT" || (el.tagName === "LINK" && el.rel === "modulepreload")) show();
    },
    true,
  );
  var timer = setTimeout(show, TIMEOUT_MS);

  window.__postcardsBootGuard = {
    cancel: function () {
      armed = false;
      clearTimeout(timer);
      if (shown) shown.remove();
      shown = null;
    },
  };
})();
