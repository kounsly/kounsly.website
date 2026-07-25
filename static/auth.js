/* Kounsly — accounts.
 *
 * Talks to Supabase's auth REST API directly rather than shipping its client
 * library: the site has no build step and no dependencies, the flows we need
 * are four HTTP calls, and a CDN script is one more thing that can be down when
 * someone is trying to sign in.
 *
 * The wall is late on purpose. Search, the whole card and the first questions
 * are open — a visitor who has not seen the catalogue has no reason to hand
 * over an address. The gate appears at the moment there is something to keep:
 * a saved programme, a deadline to be reminded of, a profile that turns "a
 * deadline" into "your deadline". Whatever they were doing when it appeared is
 * held and finished for them afterwards, so signing in never costs them the
 * click they just made.
 */
(function () {
  "use strict";

  var SESSION_KEY = "kounsly.session";
  var ANON_KEY = "kounsly.anon";
  var PENDING_KEY = "kounsly.pending";

  var cfg = { enabled: false, providers: [] };
  var session = null;      // { access_token, refresh_token, expires_at }
  var me = null;           // { user, saved, watched, quota }
  var anonQuota = null;
  var listeners = [];
  var afterSignIn = null;  // the action the wall interrupted

  function lang() { return localStorage.getItem("kounsly.lang") || "uk"; }

  var STR = {
    uk: {
      signin: "Увійти", signout: "Вийти", account: "Акаунт",
      saved_list: "Збережені", profile: "Мій профіль",
      g_save_t: "Збережи цю програму",
      g_save_b: "Створи акаунт — і твій список буде на всіх пристроях, разом із дедлайнами.",
      g_watch_t: "Нагадаємо про дедлайн",
      g_watch_b: "Надішлемо листа за два тижні й за три дні до подачі. Для цього потрібна пошта.",
      g_ask_t: "Безкоштовні питання вичерпано",
      g_ask_b: "З акаунтом — {n} питань щомісяця, безкоштовно.",
      g_profile_t: "Щоб показати саме твій дедлайн",
      g_profile_b: "Дати різні для громадян ЄС і для всіх інших. Скажи, хто ти — і побачиш свою.",
      g_default_t: "Увійди в Kounsly",
      g_default_b: "Збережені програми, нагадування про дедлайни й більше питань до асистента.",
      with_google: "Продовжити з Google", with_apple: "Продовжити з Apple",
      with_email: "Продовжити з поштою",
      email_ph: "твоя@пошта.com", email_send: "Надіслати код",
      code_t: "Код надіслано на {email}", code_ph: "6 цифр", code_send: "Підтвердити",
      code_again: "Надіслати ще раз", back: "← Інший спосіб",
      legal: "Входячи, ти погоджуєшся з умовами. Ми не продаємо дані й не надсилаємо спам.",
      err_email: "Схоже, це не пошта.", err_code: "Код не підійшов. Спробуй ще раз.",
      err_generic: "Не вдалося. Спробуй ще раз за хвилину.",
      sending: "Надсилаю…", checking: "Перевіряю…",
      ob_t: "Чотири питання — і сторінки почнуть говорити про тебе",
      ob_b: "Це вирішує, який із дедлайнів твій і чи вистачає твоїх балів. Можна пропустити.",
      ob_cit: "Твоє громадянство", ob_cit_UA: "Україна", ob_cit_EU: "Країна ЄС", ob_cit_OTHER: "Інша країна",
      ob_status: "Статус у ЄС", ob_status_none: "Немає", ob_status_protection: "Тимчасовий захист",
      ob_edu: "Що вже завершено", ob_edu_school: "Школа", ob_edu_bachelor: "Бакалавр", ob_edu_master: "Магістр",
      ob_tests: "Іспити з англійської", ob_skip: "Пропустити", ob_save: "Готово",
      ob_note: "Статус захисту змінює правила по-різному в кожній країні — цього немає на сторінках програм, тому ми ніколи не вигадуємо, що він дає.",
      asks_left: "залишилось питань: {n}", asks_left_1: "залишилось одне питання"
    },
    en: {
      signin: "Sign in", signout: "Sign out", account: "Account",
      saved_list: "Saved", profile: "My profile",
      g_save_t: "Save this programme",
      g_save_b: "Create an account and your list follows you across devices, deadlines included.",
      g_watch_t: "We'll remind you about the deadline",
      g_watch_b: "An e-mail two weeks and three days before it. That needs an address.",
      g_ask_t: "You've used your free questions",
      g_ask_b: "An account gets you {n} questions a month, free.",
      g_profile_t: "To show the deadline that is actually yours",
      g_profile_b: "Dates differ for EU citizens and everyone else. Tell us who you are and you'll see yours.",
      g_default_t: "Sign in to Kounsly",
      g_default_b: "Saved programmes, deadline reminders, and more questions for the assistant.",
      with_google: "Continue with Google", with_apple: "Continue with Apple",
      with_email: "Continue with e-mail",
      email_ph: "you@email.com", email_send: "Send code",
      code_t: "Code sent to {email}", code_ph: "6 digits", code_send: "Confirm",
      code_again: "Send again", back: "← Another way",
      legal: "By signing in you accept the terms. We don't sell data and we don't send spam.",
      err_email: "That doesn't look like an e-mail.", err_code: "That code didn't work. Try again.",
      err_generic: "Didn't work. Try again in a minute.",
      sending: "Sending…", checking: "Checking…",
      ob_t: "Four questions, and the pages start talking about you",
      ob_b: "It decides which deadline is yours and whether your scores are enough. Skippable.",
      ob_cit: "Your citizenship", ob_cit_UA: "Ukraine", ob_cit_EU: "An EU country", ob_cit_OTHER: "Somewhere else",
      ob_status: "Status in the EU", ob_status_none: "None", ob_status_protection: "Temporary protection",
      ob_edu: "Completed so far", ob_edu_school: "School", ob_edu_bachelor: "Bachelor", ob_edu_master: "Master",
      ob_tests: "English tests", ob_skip: "Skip", ob_save: "Done",
      ob_note: "Protected status changes the rules differently in every country, and programme pages don't cover it — so we never invent what it gets you.",
      asks_left: "{n} questions left", asks_left_1: "one question left"
    }
  };
  function T(k) { var s = STR[lang()] || STR.en; return s[k] || (STR.en[k] || k); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  /* ---------- device id ----------
   *
   * Anonymous questions are counted per device, not per IP: a university
   * computer lab or a shared flat is one address, and metering them together
   * would spend one person's allowance on another's questions.
   */
  function anonId() {
    var id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID()
                              : String(Date.now()) + Math.random().toString(36).slice(2));
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  }

  /* ---------- session ---------- */

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }

  function setSession(s) {
    session = s && s.access_token ? {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      // expires_in is seconds from now; store the absolute moment so a tab left
      // open overnight knows the token is stale without having to try it first.
      expires_at: s.expires_at ? Number(s.expires_at) * 1000
                               : Date.now() + (Number(s.expires_in || 3600) * 1000)
    } : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  function sbFetch(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      "apikey": cfg.anon_key,
      "content-type": "application/json"
    }, opts.headers || {});
    return fetch(cfg.url + "/auth/v1" + path, opts);
  }

  var refreshing = null;

  /** A usable access token, refreshed if it is close to expiring. Concurrent
   *  callers share one refresh: two requests racing to swap the same refresh
   *  token means one of them gets a token that has already been revoked. */
  function token() {
    if (!session) return Promise.resolve(null);
    if (Date.now() < session.expires_at - 60000) return Promise.resolve(session.access_token);
    if (refreshing) return refreshing;

    refreshing = sbFetch("/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        setSession(d);
        return session ? session.access_token : null;
      })
      .catch(function () { return null; })
      .finally(function () { refreshing = null; });
    return refreshing;
  }

  /** fetch() against our own API with the token attached when there is one. */
  function authFetch(url, opts) {
    opts = opts || {};
    return token().then(function (t) {
      if (t) opts.headers = Object.assign({}, opts.headers || {}, { authorization: "Bearer " + t });
      return fetch(url, opts);
    });
  }

  /* ---------- pending actions ----------
   *
   * What a signed-out visitor starred, kept until there is an account to put it
   * in. Held locally rather than as anonymous rows on the server: nothing is
   * stored about a person before they have agreed to be one.
   */
  function pending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{"saved":[],"watch":[]}'); }
    catch (e) { return { saved: [], watch: [] }; }
  }

  function addPending(kind, uid) {
    var p = pending();
    if (p[kind].indexOf(uid) < 0) p[kind].push(uid);
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    emit();
  }

  function removePending(kind, uid) {
    var p = pending();
    p[kind] = p[kind].filter(function (u) { return u !== uid; });
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
    emit();
  }

  function flushPending() {
    var p = pending();
    var jobs = ["saved", "watch"].filter(function (k) { return p[k].length; }).map(function (k) {
      return authFetch("/api/" + k, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uids: p[k] })
      }).then(function (r) { return r.ok ? r.json() : null; });
    });
    if (!jobs.length) return Promise.resolve();
    return Promise.all(jobs).then(function (results) {
      localStorage.removeItem(PENDING_KEY);
      var last = results.filter(Boolean).pop();
      if (last) { me = last; emit(); }
    });
  }

  /* ---------- state ---------- */

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function loadMe() {
    if (!session) { me = null; emit(); return Promise.resolve(null); }
    return authFetch("/api/me")
      .then(function (r) {
        if (r.status === 401) { setSession(null); me = null; emit(); return null; }
        return r.json();
      })
      .then(function (d) {
        me = d;
        emit();
        return d;
      })
      .catch(function () { return null; });
  }

  /* ---------- sign-in flows ---------- */

  function oauth(provider) {
    // A provider round trip is a full page load, so anything not written down
    // is gone. The programme they were reading is the thing worth keeping: the
    // wall usually opens from inside a detail sheet, and coming back to a blank
    // home page loses exactly the programme they were signing in to save.
    if (api.currentUid) sessionStorage.setItem("kounsly.resume", api.currentUid);
    location.href = cfg.url + "/auth/v1/authorize?provider=" + encodeURIComponent(provider) +
      "&redirect_to=" + encodeURIComponent(location.origin + location.pathname);
  }

  function sendCode(email) {
    return sbFetch("/otp", {
      method: "POST",
      body: JSON.stringify({ email: email, create_user: true })
    }).then(function (r) { return r.ok; });
  }

  function verifyCode(email, code) {
    return sbFetch("/verify", {
      method: "POST",
      body: JSON.stringify({ email: email, token: code, type: "email" })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.access_token) return false;
        setSession(d);
        return true;
      });
  }

  /** Tokens come back in the URL fragment after an OAuth round trip. Read them,
   *  then clear the fragment — an access token sitting in the address bar ends
   *  up in screenshots, in shared links and in browser history. */
  function captureRedirect() {
    if (!location.hash || location.hash.indexOf("access_token") < 0) return false;
    var h = new URLSearchParams(location.hash.slice(1));
    setSession({
      access_token: h.get("access_token"),
      refresh_token: h.get("refresh_token"),
      expires_in: h.get("expires_in")
    });
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }

  function signOut() {
    var t = session && session.access_token;
    if (t) sbFetch("/logout", { method: "POST", headers: { authorization: "Bearer " + t } }).catch(function () {});
    setSession(null);
    me = null;
    emit();
  }

  /* ---------- the wall ---------- */

  var REASONS = {
    save: ["g_save_t", "g_save_b"],
    watch: ["g_watch_t", "g_watch_b"],
    ask: ["g_ask_t", "g_ask_b"],
    profile: ["g_profile_t", "g_profile_b"],
    "default": ["g_default_t", "g_default_b"]
  };

  function gateNode() {
    var g = document.getElementById("gate");
    if (g) return g;
    g = document.createElement("div");
    g.className = "gate-wrap";
    g.id = "gate";
    g.addEventListener("click", function (e) { if (e.target === g) closeGate(); });
    document.body.appendChild(g);
    return g;
  }

  function closeGate() {
    var g = document.getElementById("gate");
    if (g) g.classList.remove("open");
    document.body.style.overflow = "";
    afterSignIn = null;
  }

  /** reason picks the headline: what the person was reaching for is a better
   *  argument for an account than anything we could say about the product. */
  function openGate(reason, then) {
    if (!cfg.enabled) { if (then) then(); return; }
    afterSignIn = then || null;
    var keys = REASONS[reason] || REASONS["default"];
    var body = T(keys[1]).replace("{n}", cfg.free_asks || 15);
    var g = gateNode();

    var buttons = "";
    if (cfg.providers.indexOf("google") >= 0)
      buttons += '<button class="gate-btn g-google" data-provider="google">' +
        '<span class="gi">' + GOOGLE_MARK + "</span>" + esc(T("with_google")) + "</button>";
    if (cfg.providers.indexOf("apple") >= 0)
      buttons += '<button class="gate-btn g-apple" data-provider="apple">' +
        '<span class="gi">' + APPLE_MARK + "</span>" + esc(T("with_apple")) + "</button>";
    if (cfg.providers.indexOf("email") >= 0)
      buttons += '<button class="gate-btn g-email" data-provider="email">' +
        '<span class="gi">✉</span>' + esc(T("with_email")) + "</button>";

    g.innerHTML =
      '<div class="gate" role="dialog" aria-modal="true">' +
        '<button class="gate-close" aria-label="Close">✕</button>' +
        '<h2>' + esc(T(keys[0])) + "</h2>" +
        '<p class="gate-lede">' + esc(body) + "</p>" +
        '<div class="gate-choices">' + buttons + "</div>" +
        '<div class="gate-step" id="gate-step"></div>' +
        '<p class="gate-legal">' + esc(T("legal")) + "</p>" +
      "</div>";

    g.classList.add("open");
    document.body.style.overflow = "hidden";
    g.querySelector(".gate-close").onclick = closeGate;
    g.querySelectorAll(".gate-btn").forEach(function (b) {
      b.onclick = function () {
        var p = b.getAttribute("data-provider");
        if (p === "email") emailStep();
        else oauth(p);
      };
    });
  }

  function emailStep() {
    var g = document.getElementById("gate");
    g.querySelector(".gate-choices").style.display = "none";
    var step = document.getElementById("gate-step");
    step.innerHTML =
      '<form class="gate-form" id="gate-email">' +
        '<input type="email" id="gate-email-in" autocomplete="email" inputmode="email" placeholder="' + esc(T("email_ph")) + '" required>' +
        '<button type="submit">' + esc(T("email_send")) + "</button>" +
      "</form>" +
      '<div class="gate-err" id="gate-err"></div>' +
      '<button class="gate-back" type="button">' + esc(T("back")) + "</button>";

    step.querySelector(".gate-back").onclick = function () {
      g.querySelector(".gate-choices").style.display = "";
      step.innerHTML = "";
    };

    var input = document.getElementById("gate-email-in");
    input.focus();
    document.getElementById("gate-email").onsubmit = function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { fail(T("err_email")); return; }
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      btn.textContent = T("sending");
      sendCode(email)
        .then(function (ok) { if (ok) codeStep(email); else fail(T("err_generic")); })
        .catch(function () { fail(T("err_generic")); })
        .finally(function () { btn.disabled = false; btn.textContent = T("email_send"); });
    };
  }

  function codeStep(email) {
    var step = document.getElementById("gate-step");
    step.innerHTML =
      '<p class="gate-sent">' + esc(T("code_t").replace("{email}", email)) + "</p>" +
      '<form class="gate-form" id="gate-code">' +
        '<input type="text" id="gate-code-in" inputmode="numeric" autocomplete="one-time-code" ' +
          'maxlength="6" pattern="[0-9]*" placeholder="' + esc(T("code_ph")) + '" required>' +
        '<button type="submit">' + esc(T("code_send")) + "</button>" +
      "</form>" +
      '<div class="gate-err" id="gate-err"></div>' +
      '<button class="gate-back" type="button">' + esc(T("code_again")) + "</button>";

    step.querySelector(".gate-back").onclick = function () { sendCode(email); };
    var input = document.getElementById("gate-code-in");
    input.focus();

    document.getElementById("gate-code").onsubmit = function (e) {
      e.preventDefault();
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      btn.textContent = T("checking");
      verifyCode(email, input.value.trim())
        .then(function (ok) {
          if (!ok) { fail(T("err_code")); return; }
          arrived();
        })
        .catch(function () { fail(T("err_generic")); })
        .finally(function () { btn.disabled = false; btn.textContent = T("code_send"); });
    };
  }

  function fail(message) {
    var box = document.getElementById("gate-err");
    if (box) box.textContent = message;
  }

  /** Signed in, by whichever route. Move the shortlist over, then finish the
   *  thing the wall interrupted before anything else happens. */
  function arrived() {
    var resume = afterSignIn;
    afterSignIn = null;
    return loadMe()
      .then(flushPending)
      .then(loadMe)
      .then(function () {
        closeGate();
        if (resume) resume();
        if (me && me.user && !me.user.onboarded) openOnboarding();
      });
  }

  /* ---------- onboarding ----------
   *
   * Asked once, right after signing in, while the reason is still fresh. Four
   * one-tap questions and a skip — this is the payoff for the account, not a
   * form to get through before the product starts.
   */

  function choiceRow(field, key, options, chosen) {
    return '<div class="ob-row"><b>' + esc(T(key)) + "</b><div class=\"ob-opts\">" +
      options.map(function (o) {
        return '<button type="button" class="ob-opt' + (chosen === o ? " on" : "") +
          '" data-field="' + field + '" data-value="' + esc(o) + '">' + esc(T(key + "_" + o)) + "</button>";
      }).join("") + "</div></div>";
  }

  function openOnboarding() {
    var p = (me && me.user && me.user.profile) || {};
    var draft = { citizenship: p.citizenship, status: p.status, education: p.education,
                  ielts: p.ielts, toefl: p.toefl };
    var g = gateNode();

    g.innerHTML =
      '<div class="gate onboard" role="dialog" aria-modal="true">' +
        '<button class="gate-close" aria-label="Close">✕</button>' +
        "<h2>" + esc(T("ob_t")) + "</h2>" +
        '<p class="gate-lede">' + esc(T("ob_b")) + "</p>" +
        choiceRow("citizenship", "ob_cit", ["UA", "EU", "OTHER"], draft.citizenship) +
        choiceRow("status", "ob_status", ["none", "protection"], draft.status) +
        choiceRow("education", "ob_edu", ["school", "bachelor", "master"], draft.education) +
        '<div class="ob-row"><b>' + esc(T("ob_tests")) + "</b>" +
          '<div class="ob-tests">' +
            '<input id="ob-ielts" inputmode="decimal" placeholder="IELTS" value="' + esc(draft.ielts == null ? "" : draft.ielts) + '">' +
            '<input id="ob-toefl" inputmode="numeric" placeholder="TOEFL" value="' + esc(draft.toefl == null ? "" : draft.toefl) + '">' +
          "</div></div>" +
        '<div class="ob-note" id="ob-note" hidden>' + esc(T("ob_note")) + "</div>" +
        '<div class="ob-actions">' +
          '<button type="button" class="ob-skip">' + esc(T("ob_skip")) + "</button>" +
          '<button type="button" class="ob-save">' + esc(T("ob_save")) + "</button>" +
        "</div>" +
      "</div>";

    g.classList.add("open");
    document.body.style.overflow = "hidden";

    g.querySelectorAll(".ob-opt").forEach(function (b) {
      b.onclick = function () {
        var field = b.getAttribute("data-field");
        var value = b.getAttribute("data-value");
        draft[field] = draft[field] === value ? null : value;
        g.querySelectorAll('.ob-opt[data-field="' + field + '"]').forEach(function (o) {
          o.classList.toggle("on", o.getAttribute("data-value") === draft[field]);
        });
        // Protected status is the one answer we must not quietly act on: what it
        // changes differs by country and is not on these pages.
        document.getElementById("ob-note").hidden = draft.status !== "protection";
      };
    });

    function finish(save) {
      if (!save) { closeGate(); markOnboarded(); return; }
      var ielts = parseFloat(document.getElementById("ob-ielts").value.replace(",", "."));
      var toefl = parseInt(document.getElementById("ob-toefl").value, 10);
      saveProfile({
        citizenship: draft.citizenship || null,
        status: draft.status || null,
        education: draft.education || null,
        ielts: isNaN(ielts) ? null : ielts,
        toefl: isNaN(toefl) ? null : toefl
      }).then(closeGate);
    }

    g.querySelector(".gate-close").onclick = function () { finish(false); };
    g.querySelector(".ob-skip").onclick = function () { finish(false); };
    g.querySelector(".ob-save").onclick = function () { finish(true); };
  }

  function saveProfile(data) {
    return authFetch("/api/me", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ lang: lang() }, data))
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { me = d; emit(); } return d; });
  }

  /** Skipping still answers the question "have we asked this person yet". */
  function markOnboarded() { saveProfile({}); }

  /* ---------- lists ---------- */

  function isSaved(uid) {
    if (me) return me.saved.indexOf(uid) >= 0;
    return pending().saved.indexOf(uid) >= 0;
  }

  function isWatched(uid) {
    if (me) return me.watched.indexOf(uid) >= 0;
    return pending().watch.indexOf(uid) >= 0;
  }

  /** Star or unstar. Signed out, the star still fills in — the programme is
   *  held locally and the wall opens behind it. Refusing the click outright and
   *  showing a login box instead reads as a toll gate; this reads as an offer. */
  function toggle(kind, uid) {
    var on = kind === "saved" ? isSaved(uid) : isWatched(uid);
    var list = kind === "saved" ? "saved" : "watch";

    if (!me) {
      if (on) removePending(list, uid);
      else {
        addPending(list, uid);
        openGate(kind === "saved" ? "save" : "watch", null);
      }
      return Promise.resolve();
    }

    var request = on
      ? authFetch("/api/" + list + "/" + encodeURIComponent(uid), { method: "DELETE" })
      : authFetch("/api/" + list, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uids: [uid] })
        });

    // Paint it now and correct it if the write fails: a star that waits for the
    // network feels broken at exactly the moment we are asking for trust.
    var key = kind === "saved" ? "saved" : "watched";
    if (on) me[key] = me[key].filter(function (u) { return u !== uid; });
    else me[key] = [uid].concat(me[key]);
    emit();

    return request
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { me = d; emit(); } })
      .catch(function () { loadMe(); });
  }

  /* ---------- brand marks (inline: the page loads no third-party assets) ---------- */

  var GOOGLE_MARK =
    '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">' +
    '<path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-4H24v7.5h12c-.2 2-1.5 5-4.4 7l6.7 5.2C42.2 36 45 30.6 45 24z"/>' +
    '<path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.7-5.2c-1.9 1.3-4.4 2.2-7.8 2.2-6 0-11-4-12.8-9.4l-7 5.4C7.8 40.8 15.3 46 24 46z"/>' +
    '<path fill="#FBBC05" d="M11.2 28.3c-.5-1.4-.8-2.8-.8-4.3s.3-3 .8-4.3l-7-5.4C2.8 17.2 2 20.5 2 24s.8 6.8 2.2 9.7l7-5.4z"/>' +
    '<path fill="#EA4335" d="M24 10.4c3.3 0 5.6 1.4 6.9 2.6l5.9-5.8C33.2 3.9 28.8 2 24 2 15.3 2 7.8 7.2 4.2 14.3l7 5.4C13 14.4 18 10.4 24 10.4z"/></svg>';

  var APPLE_MARK =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">' +
    '<path d="M16.4 12.8c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9s-1.9-.9-3.1-.8c-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.5 3 2.4 1.2 0 1.6-.8 3.1-.8s1.9.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.6-1-2.6-4zM14 5.4c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/></svg>';

  /* ---------- header ---------- */

  function paintHeader() {
    var slot = document.getElementById("authslot");
    if (!slot) return;
    if (!cfg.enabled) { slot.innerHTML = ""; return; }

    if (!me) {
      slot.innerHTML = '<button class="signin" id="signinbtn">' + esc(T("signin")) + "</button>";
      document.getElementById("signinbtn").onclick = function () { openGate("default", null); };
      return;
    }

    var email = (me.user && me.user.email) || "";
    slot.innerHTML =
      '<div class="acct">' +
        '<button class="acct-btn" id="acctbtn" aria-haspopup="true">' +
          '<span class="acct-i">' + esc((email[0] || "?").toUpperCase()) + "</span>" +
        "</button>" +
        '<div class="acct-menu" id="acctmenu" hidden>' +
          '<div class="acct-email">' + esc(email) + "</div>" +
          '<button data-act="saved">' + esc(T("saved_list")) + " (" + me.saved.length + ")</button>" +
          '<button data-act="profile">' + esc(T("profile")) + "</button>" +
          '<button data-act="out">' + esc(T("signout")) + "</button>" +
        "</div>" +
      "</div>";

    var menu = document.getElementById("acctmenu");
    document.getElementById("acctbtn").onclick = function (e) {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    };
    menu.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () {
        menu.hidden = true;
        var act = b.getAttribute("data-act");
        if (act === "out") signOut();
        else if (act === "profile") openOnboarding();
        else if (act === "saved" && api.onShowSaved) api.onShowSaved();
      };
    });
  }

  // Bound once, not per repaint: the header is redrawn on every state change,
  // and a listener added there would accumulate one per redraw.
  document.addEventListener("click", function () {
    var menu = document.getElementById("acctmenu");
    if (menu) menu.hidden = true;
  });

  /* ---------- boot ---------- */

  var api = {
    enabled: false,
    onShowSaved: null,
    currentUid: null,   // set by the page when a detail sheet is open

    /** The programme to reopen after a provider round trip, once. */
    resumeUid: function () {
      var uid = sessionStorage.getItem("kounsly.resume");
      sessionStorage.removeItem("kounsly.resume");
      return uid || null;
    },

    init: function (onChange) {
      if (onChange) listeners.push(onChange);
      listeners.push(paintHeader);

      var justReturned = captureRedirect();
      session = session || loadSession();

      return fetch("/api/config?anon_id=" + encodeURIComponent(anonId()))
        .then(function (r) { return r.json(); })
        .then(function (c) {
          cfg = c || cfg;
          api.enabled = !!cfg.enabled;
          anonQuota = cfg.quota || null;
          if (!api.enabled) { emit(); return null; }
          if (justReturned) return arrived();
          return loadMe();
        })
        .catch(function () { emit(); return null; });
    },

    anonId: anonId,
    user: function () { return me && me.user; },
    signedIn: function () { return !!me; },
    reminders: function () { return !!cfg.reminders; },
    quota: function () { return (me && me.quota) || anonQuota; },
    setQuota: function (q) { if (me) me.quota = q; else anonQuota = q; emit(); },
    quotaLabel: function () {
      var q = api.quota();
      if (!q || q.remaining == null) return "";
      if (q.remaining === 1) return T("asks_left_1");
      return T("asks_left").replace("{n}", q.remaining);
    },

    fetch: authFetch,
    isSaved: isSaved,
    isWatched: isWatched,
    toggleSaved: function (uid) { return toggle("saved", uid); },
    toggleWatched: function (uid) { return toggle("watch", uid); },
    savedUids: function () { return me ? me.saved.slice() : pending().saved.slice(); },

    /** Ask for an account for a stated reason, and run `then` once there is
     *  one. Already signed in, `then` runs immediately — callers never have to
     *  branch on it. */
    require: function (reason, then) {
      if (!cfg.enabled || me) { if (then) then(); return; }
      openGate(reason, then);
    },
    openGate: openGate,
    openProfile: openOnboarding,
    signOut: signOut,
    /** Redraw everything that depends on the account — the page calls this when
     *  the language changes, since the header and the wall are translated too. */
    refresh: emit,
    T: T
  };

  window.KounslyAuth = api;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeGate(); });
})();
