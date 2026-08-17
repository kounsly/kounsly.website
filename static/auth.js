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
      deadlines_list: "Дедлайни",
      g_save_t: "Збережи цю програму",
      g_save_b: "Створи акаунт — і твій список буде на всіх пристроях, разом із дедлайнами.",
      g_watch_t: "Нагадаємо про дедлайн",
      g_watch_b: "Надішлемо листа за два тижні й за три дні до подачі. Для цього потрібна пошта.",
      g_ask_t: "Безкоштовні питання вичерпано",
      g_ask_b: "З акаунтом — {n} питань щомісяця, безкоштовно.",
      g_profile_t: "Щоб показати саме твій дедлайн",
      g_profile_b: "Дати різні для громадян ЄС і для всіх інших. Скажи, хто ти — і побачиш свою.",
      g_signup_t: "Створи акаунт", g_signup_b: "Збережені програми з нотатками, твої дедлайни й більше питань до асистента.",
      g_view_t: "Дві програми ти вже подивилась",
      g_view_b: "Зареєструйся — і відкривай усі 96 000 програм із деталями, дедлайнами й асистентом.",
      g_filter_t: "Ці фільтри — з акаунтом",
      g_filter_b: "Країна, рівень, бюджет і «лише безкоштовні». Пошук за спеціальністю працює й без реєстрації.",
      // Two labels for one button. "Зареєструватися" is fifteen characters and
      // 152 pixels wide; next to "Увійти", the language and theme buttons it
      // pushed the header 72px past the edge of a 390px phone, so the main
      // call to action on the site was the part hanging off the screen.
      signup: "Зареєструватися", signup_short: "Створити",
      g_default_t: "Увійди в Kounsly",
      g_default_b: "Збережені програми, нагадування про дедлайни й більше питань до асистента.",
      with_google: "Продовжити з Google", with_apple: "Продовжити з Apple",
      with_email: "Продовжити з поштою",
      email_ph: "твоя@пошта.com", email_send: "Надіслати код",
      code_t: "Код надіслано на {email}", code_ph: "6 цифр", code_send: "Підтвердити",
      code_again: "Надіслати ще раз", back: "← Інший спосіб",
      pw_ph: "Пароль", pw_ph_up: "Пароль — від 8 символів", pw_in: "Увійти", pw_up: "Створити акаунт",
      to_up: "Немає акаунта? Створити", to_in: "Вже є акаунт? Увійти",
      pw_forgot: "Забув пароль?", pw_code: "Увійти кодом з пошти",
      pw_confirm_t: "Підтвердь пошту",
      pw_confirm_b: "Надіслали лист на {email}. Відкрий його — і акаунт буде готовий.",
      pw_unconf_t: "Пошта ще не підтверджена",
      pw_unconf_b: "Акаунт для {email} уже є, але лист із підтвердженням ще не відкритий. Перевір пошту — і спам теж. Або надішлемо ще раз.",
      pw_signup_note: "Надішлемо лист — відкрий у ньому посилання, і акаунт буде готовий.",
      pw_confirm_again: "Не прийшов? Надіслати ще раз",
      pw_confirm_resent: "Надіслали ще раз. Перевір і теку «Спам».",
      pw_confirm_wait: "Ще раз — за {n} с",
      pw_reset_sent: "Якщо на {email} є акаунт, лист для зміни пароля вже в дорозі.",
      pw_new_t: "Новий пароль", pw_new_b: "Придумай новий пароль — і одразу ним увійдеш.",
      pw_new_ph: "Новий пароль", pw_new_save: "Зберегти",
      pw_changed: "Пароль змінено.",
      legal: "Входячи, ти погоджуєшся з {terms} і {privacy}.",
      legal_terms: "умовами", legal_privacy: "політикою приватності",
      err_email: "Схоже, це не пошта.", err_code: "Код не підійшов. Спробуй ще раз.",
      err_pw_short: "Пароль має бути щонайменше 8 символів.",
      err_pw_wrong: "Пошта або пароль не підходять.",
      err_pw_taken: "Такий акаунт уже є. Спробуй увійти.",
      err_pw_unconfirmed: "Пошта ще не підтверджена — перевір лист від нас.",
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
      deadlines_list: "Deadlines",
      g_save_t: "Save this programme",
      g_save_b: "Create an account and your list follows you across devices, deadlines included.",
      g_watch_t: "We'll remind you about the deadline",
      g_watch_b: "An e-mail two weeks and three days before it. That needs an address.",
      g_ask_t: "You've used your free questions",
      g_ask_b: "An account gets you {n} questions a month, free.",
      g_profile_t: "To show the deadline that is actually yours",
      g_profile_b: "Dates differ for EU citizens and everyone else. Tell us who you are and you'll see yours.",
      g_signup_t: "Create an account", g_signup_b: "Saved programmes with notes, your deadlines, and more questions for the assistant.",
      g_view_t: "You've seen two programmes",
      g_view_b: "Create an account and open all 96,000 in full — deadlines, requirements and the assistant included.",
      g_filter_t: "These filters come with an account",
      g_filter_b: "Country, level, budget and free-only. Searching by subject works without one.",
      signup: "Sign up", signup_short: "Sign up",
      g_default_t: "Sign in to Kounsly",
      g_default_b: "Saved programmes, deadline reminders, and more questions for the assistant.",
      with_google: "Continue with Google", with_apple: "Continue with Apple",
      with_email: "Continue with e-mail",
      email_ph: "you@email.com", email_send: "Send code",
      code_t: "Code sent to {email}", code_ph: "6 digits", code_send: "Confirm",
      code_again: "Send again", back: "← Another way",
      pw_ph: "Password", pw_ph_up: "Password — 8 characters or more", pw_in: "Sign in", pw_up: "Create account",
      to_up: "No account? Create one", to_in: "Already have one? Sign in",
      pw_forgot: "Forgot your password?", pw_code: "E-mail me a code instead",
      pw_confirm_t: "Confirm your e-mail",
      pw_confirm_b: "We sent a message to {email}. Open it and the account is ready.",
      pw_unconf_t: "That address isn't confirmed yet",
      pw_unconf_b: "There is an account for {email}, but the confirmation e-mail hasn't been opened. Check your inbox — and your spam. Or we'll send it again.",
      pw_signup_note: "We'll e-mail you a link. Open it and the account is ready.",
      pw_confirm_again: "Didn't arrive? Send it again",
      pw_confirm_resent: "Sent again. Check your spam folder too.",
      pw_confirm_wait: "Again in {n}s",
      pw_reset_sent: "If {email} has an account, a reset e-mail is on its way.",
      pw_new_t: "New password", pw_new_b: "Pick a new one and you're signed in with it.",
      pw_new_ph: "New password", pw_new_save: "Save",
      pw_changed: "Password changed.",
      legal: "By signing in you accept the {terms} and the {privacy}.",
      legal_terms: "terms", legal_privacy: "privacy policy",
      err_email: "That doesn't look like an e-mail.", err_code: "That code didn't work. Try again.",
      err_pw_short: "A password needs at least 8 characters.",
      err_pw_wrong: "That e-mail and password don't match.",
      err_pw_taken: "There's already an account for this address. Try signing in.",
      err_pw_unconfirmed: "That address isn't confirmed yet — check for our e-mail.",
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
      // Never silent: a failed /api/me still means "nobody is signed in", and
      // the header has to say so rather than stay blank.
      .catch(function () { me = null; emit(); return null; });
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

  /** POST to Supabase's auth API, resolved to { ok, status, data } so callers
   *  can read an error body without each of them handling a non-JSON reply. */
  function sbPost(path, body, headers) {
    return sbFetch(path, { method: "POST", body: JSON.stringify(body), headers: headers })
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (d) { return { ok: r.ok, status: r.status, data: d || {} }; });
      });
  }

  /** Supabase's error shape changed between versions and differs by endpoint —
   *  a code in `error_code` on current projects, a sentence in `msg` or
   *  `error_description` on older ones. Normalise to the few cases the sign-in
   *  box actually says something different about; everything else is generic. */
  function errCode(data) {
    var code = data.error_code || data.code || "";
    if (code) return code;
    var text = String(data.msg || data.error_description || data.error || "").toLowerCase();
    if (text.indexOf("invalid login") >= 0 || text.indexOf("invalid grant") >= 0) return "invalid_credentials";
    if (text.indexOf("not confirmed") >= 0) return "email_not_confirmed";
    if (text.indexOf("already registered") >= 0 || text.indexOf("already been registered") >= 0) return "user_already_exists";
    if (text.indexOf("password") >= 0 && text.indexOf("least") >= 0) return "weak_password";
    return "";
  }

  var PW_ERRORS = {
    invalid_credentials: "err_pw_wrong",
    email_not_confirmed: "err_pw_unconfirmed",
    user_already_exists: "err_pw_taken",
    email_exists: "err_pw_taken",
    weak_password: "err_pw_short"
  };

  function sendCode(email) {
    return sbFetch("/otp", {
      method: "POST",
      body: JSON.stringify({ email: email, create_user: true })
    }).then(function (r) { return r.ok; });
  }

  /* ---------- password ----------
   *
   * A password is the sign-in most people expect, and the only one that works
   * when the e-mail takes four minutes to arrive or lands in spam. The code
   * flow above stays as the way back in for anyone who has forgotten theirs
   * before they ask for a reset.
   */

  function signInPassword(email, password) {
    return sbPost("/token?grant_type=password", { email: email, password: password })
      .then(function (r) {
        if (r.ok && r.data.access_token) { setSession(r.data); return { ok: true }; }
        return { ok: false, code: errCode(r.data) };
      });
  }

  function signUpPassword(email, password) {
    // Say where the link in the e-mail should land. Without it Supabase falls
    // back to the project's Site URL, which is whatever it was set to on the
    // day the project was made — a confirmation that opens localhost:3000 is a
    // sign-up nobody can finish, and nothing on this side would show it.
    return sbPost("/signup?redirect_to=" + encodeURIComponent(location.origin + location.pathname),
                  { email: email, password: password })
      .then(function (r) {
        if (!r.ok) return { ok: false, code: errCode(r.data) };
        // With e-mail confirmation on — the default, and worth keeping — the
        // reply carries a user but no session: the account exists and is not
        // usable until the link in the e-mail is opened.
        if (r.data.access_token) { setSession(r.data); return { ok: true, signedIn: true }; }
        return { ok: true, signedIn: false };
      });
  }

  /** Send the confirmation e-mail again. The first one goes to spam often
   *  enough that without this the sign-up ends here: the account exists, so
   *  registering again with the same address is refused, and there is no way
   *  back to the message that would finish it. */
  function resendConfirm(email) {
    return sbPost("/resend?redirect_to=" + encodeURIComponent(location.origin + location.pathname),
                  { type: "signup", email: email })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  /** Always reported as sent, whatever the answer. Telling a stranger whether
   *  an address has an account here is telling them who our users are. */
  function sendReset(email) {
    return sbPost("/recover?redirect_to=" + encodeURIComponent(location.origin + location.pathname),
                  { email: email })
      .then(function () { return true; })
      .catch(function () { return true; });
  }

  function setPassword(password) {
    return token().then(function (t) {
      if (!t) return { ok: false, code: "" };
      return sbFetch("/user", {
        method: "PUT",
        headers: { authorization: "Bearer " + t },
        body: JSON.stringify({ password: password })
      }).then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (d) { return { ok: r.ok, code: r.ok ? "" : errCode(d || {}) }; });
      });
    });
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

  /** Tokens come back in the URL fragment after an OAuth round trip, and after
   *  the links in our confirmation and password-reset e-mails. Read them, then
   *  clear the fragment — an access token sitting in the address bar ends up in
   *  screenshots, in shared links and in browser history.
   *
   *  Returns the kind of arrival, because a recovery link means the same thing
   *  as a sign-in plus one more step: they came here to change the password. */
  var arrivalType = null;

  function captureRedirect() {
    if (!location.hash) return false;
    var h = new URLSearchParams(location.hash.slice(1));

    // An expired or already-used link comes back as an error rather than a
    // token. Silently doing nothing looks like the link was ignored.
    if (h.get("error")) {
      arrivalType = "error";
      history.replaceState(null, "", location.pathname + location.search);
      return false;
    }
    if (!h.get("access_token")) return false;

    arrivalType = h.get("type") || "signin";
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
    signup: ["g_signup_t", "g_signup_b"],
    // Limits reached rather than features reached for: the third programme
    // opened without an account, and the filters that need one.
    view: ["g_view_t", "g_view_b"],
    filter: ["g_filter_t", "g_filter_b"],
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
    // Not unconditionally "": the wall usually opens from inside an open detail
    // sheet, and that sheet locked the page behind it for the same reason.
    // Clearing the lock on the way out of the wall handed the scroll back to
    // the page underneath, so a drag over a still-open sheet moved the search
    // results behind it instead.
    var sheet = document.getElementById("sheet-wrap");
    document.body.style.overflow =
      sheet && sheet.classList.contains("open") ? "hidden" : "";
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
        // The terms are a link, not a word: promising "we don't sell data" in a
        // sentence nobody can click is a claim with nothing behind it. The page
        // it points at is where that promise is actually made, and where a
        // payment provider will look for it.
        // Both pages, not just the terms: the privacy policy is the half of the
        // promise about what happens to the address they are about to type, and
        // it lives at its own URL — naming it without linking it is the same
        // uncheckable claim the terms link exists to avoid.
        '<p class="gate-legal">' +
          esc(T("legal"))
            .replace("{terms}",
              '<a href="/terms" target="_blank" rel="noopener">' + esc(T("legal_terms")) + "</a>")
            .replace("{privacy}",
              '<a href="/privacy" target="_blank" rel="noopener">' + esc(T("legal_privacy")) + "</a>") +
        "</p>" +
      "</div>";

    g.classList.add("open");
    document.body.style.overflow = "hidden";
    g.querySelector(".gate-close").onclick = closeGate;
    // Which form the e-mail route opens on follows the button that opened the
    // wall. Someone who pressed "Sign up" and lands on a box saying "Sign in"
    // has to read the small print under it to find out they are in the wrong
    // one; the other reasons are all interruptions of someone already using
    // the site, and those are far more often people who have been here before.
    var emailMode = reason === "signup" ? "up" : "in";
    g.querySelectorAll(".gate-btn").forEach(function (b) {
      b.onclick = function () {
        var p = b.getAttribute("data-provider");
        if (p === "email") emailStep(emailMode);
        else oauth(p);
      };
    });
  }

  function looksLikeEmail(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }

  /** Hide the provider buttons and give the step area back a way out. */
  function stepAlone() {
    var g = document.getElementById("gate");
    var choices = g.querySelector(".gate-choices");
    if (choices) choices.style.display = "none";
    return document.getElementById("gate-step");
  }

  function backToChoices() {
    var g = document.getElementById("gate");
    if (!g) return;
    var choices = g.querySelector(".gate-choices");
    if (choices) choices.style.display = "";
    var step = document.getElementById("gate-step");
    if (step) step.innerHTML = "";
  }

  /* The e-mail route asks for a password, because that is the sign-in people
   * expect and the one that still works when the e-mail is slow or in spam.
   * `mode` is "in" or "up"; both are one form, because which one someone needs
   * is not something they should have to decide before typing their address. */
  function emailStep(mode, email) {
    mode = mode === "up" ? "up" : "in";
    var step = stepAlone();
    var submit = mode === "up" ? "pw_up" : "pw_in";

    step.innerHTML =
      // novalidate: the rules are checked below, in our words and in the
      // reader's language. Left to the browser, `minlength` silently refuses to
      // submit and shows its own tooltip — in the browser's language, not the
      // page's — and the message written for this box never appears.
      '<form class="gate-form stack" id="gate-email" novalidate>' +
        '<input type="email" id="gate-email-in" autocomplete="email" inputmode="email" ' +
          'placeholder="' + esc(T("email_ph")) + '" value="' + esc(email || "") + '" required>' +
        // The rule is in the placeholder when a password is being chosen, so it
        // is read before it is broken. Told only after the submit, it reads as
        // a rejection of something they already decided on.
        '<input type="password" id="gate-pw-in" placeholder="' +
          esc(T(mode === "up" ? "pw_ph_up" : "pw_ph")) + '" ' +
          'autocomplete="' + (mode === "up" ? "new-password" : "current-password") + '" required>' +
        '<button type="submit">' + esc(T(submit)) + "</button>" +
      "</form>" +
      // Said before the button, not after it. Signing up does not sign you in
      // here — a confirmation link does — and someone who was not told that
      // reads the step that follows as the form having failed.
      (mode === "up" ? '<p class="gate-note">' + esc(T("pw_signup_note")) + "</p>" : "") +
      '<div class="gate-err" id="gate-err"></div>' +
      '<div class="gate-links">' +
        '<button type="button" data-act="mode">' + esc(T(mode === "up" ? "to_in" : "to_up")) + "</button>" +
        (mode === "up" ? "" : '<button type="button" data-act="forgot">' + esc(T("pw_forgot")) + "</button>") +
        // Only when the project can actually send a code — see email_code in
        // auth.py. Without custom SMTP the e-mail carries a link instead, and
        // the reader is left staring at a box for six digits that never come.
        (cfg.email_code ? '<button type="button" data-act="code">' + esc(T("pw_code")) + "</button>" : "") +
      "</div>" +
      '<button class="gate-back" type="button">' + esc(T("back")) + "</button>";

    var emailIn = document.getElementById("gate-email-in");
    var pwIn = document.getElementById("gate-pw-in");
    (email ? pwIn : emailIn).focus();

    step.querySelector(".gate-back").onclick = backToChoices;
    step.querySelectorAll(".gate-links button").forEach(function (b) {
      b.onclick = function () {
        var act = b.getAttribute("data-act");
        var typed = emailIn.value.trim();
        if (act === "mode") emailStep(mode === "up" ? "in" : "up", typed);
        else if (act === "code") codeRequestStep(typed);
        else if (act === "forgot") resetStep(typed);
      };
    });

    document.getElementById("gate-email").onsubmit = function (e) {
      e.preventDefault();
      var address = emailIn.value.trim();
      var password = pwIn.value;
      if (!looksLikeEmail(address)) { fail(T("err_email")); return; }
      if (password.length < 8) { fail(T("err_pw_short")); return; }

      var btn = e.target.querySelector("button");
      btn.disabled = true;
      btn.textContent = T(mode === "up" ? "sending" : "checking");
      fail("");

      var run = mode === "up" ? signUpPassword(address, password) : signInPassword(address, password);
      run
        .then(function (r) {
          if (!r.ok) {
            // "Not confirmed" is the one failure with something to do about it,
            // and a sentence in red is not it: the account is already made, so
            // signing up again will not work either. Send them to the step that
            // can put another message in their inbox.
            if (r.code === "email_not_confirmed") { unconfirmedStep(address); return; }
            fail(T(PW_ERRORS[r.code] || "err_generic"));
            return;
          }
          if (mode === "up" && !r.signedIn) { confirmSentStep(address); return; }
          arrived();
        })
        .catch(function () { fail(T("err_generic")); })
        .finally(function () {
          if (!document.getElementById("gate-email")) return;   // the step moved on
          btn.disabled = false;
          btn.textContent = T(submit);
        });
    };
  }

  /** Waiting on the confirmation e-mail — reached two ways, and both used to
   *  be dead ends. Straight after signing up, and again weeks later when the
   *  message was never opened and the sign-in comes back "not confirmed": the
   *  account exists, so signing up again is refused, and the only thing that
   *  finishes it is a link in a message that may be in spam or may never have
   *  arrived. The way out of both is the same button.
   *
   *  `title`/`body` differ because the two arrivals are not the same news. */
  function confirmWaitStep(email, title, body) {
    var step = stepAlone();
    step.innerHTML =
      "<h3 class=\"gate-sub\">" + esc(T(title)) + "</h3>" +
      '<p class="gate-sent">' + esc(T(body).replace("{email}", email)) + "</p>" +
      '<div class="gate-links">' +
        '<button type="button" data-act="again">' + esc(T("pw_confirm_again")) + "</button>" +
      "</div>" +
      '<div class="gate-err" id="gate-err"></div>' +
      '<button class="gate-back" type="button">' + esc(T("back")) + "</button>";
    step.querySelector(".gate-back").onclick = backToChoices;

    // Supabase rate-limits this endpoint, and a button that can be pressed
    // faster than the server will answer only earns a 429 and an error where a
    // sent e-mail should be. The countdown is the honest version of the wait.
    var again = step.querySelector('[data-act="again"]');
    var timer = null;
    function cooldown(seconds) {
      if (timer) clearInterval(timer);
      again.disabled = true;
      var left = seconds;
      var tick = function () {
        // The step can be replaced while the countdown runs — leave no interval
        // ticking against a button that is no longer in the document.
        if (!document.body.contains(again)) { clearInterval(timer); timer = null; return; }
        if (left <= 0) {
          clearInterval(timer); timer = null;
          again.disabled = false;
          again.textContent = T("pw_confirm_again");
          return;
        }
        again.textContent = T("pw_confirm_wait").replace("{n}", left);
        left -= 1;
      };
      tick();
      timer = setInterval(tick, 1000);
    }

    again.onclick = function () {
      again.disabled = true;
      again.textContent = T("sending");
      fail("");
      resendConfirm(email).then(function (ok) {
        // The step may have been left while the request was in flight.
        if (!document.body.contains(again)) return;
        if (ok) note(T("pw_confirm_resent"));
        else fail(T("err_generic"));
        cooldown(60);
      });
    };
  }

  /** Just signed up: the message is on its way. */
  function confirmSentStep(email) {
    confirmWaitStep(email, "pw_confirm_t", "pw_confirm_b");
  }

  /** Came back to sign in, and the address was never confirmed. */
  function unconfirmedStep(email) {
    confirmWaitStep(email, "pw_unconf_t", "pw_unconf_b");
  }

  function resetStep(email) {
    var step = stepAlone();
    step.innerHTML =
      "<h3 class=\"gate-sub\">" + esc(T("pw_forgot")) + "</h3>" +
      '<form class="gate-form" id="gate-reset" novalidate>' +
        '<input type="email" id="gate-reset-in" autocomplete="email" inputmode="email" ' +
          'placeholder="' + esc(T("email_ph")) + '" value="' + esc(email || "") + '" required>' +
        "<button type=\"submit\">" + esc(T("email_send")) + "</button>" +
      "</form>" +
      '<div class="gate-err" id="gate-err"></div>' +
      '<button class="gate-back" type="button">' + esc(T("back")) + "</button>";

    step.querySelector(".gate-back").onclick = function () { emailStep("in", email); };
    var input = document.getElementById("gate-reset-in");
    input.focus();
    document.getElementById("gate-reset").onsubmit = function (e) {
      e.preventDefault();
      var address = input.value.trim();
      if (!looksLikeEmail(address)) { fail(T("err_email")); return; }
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      btn.textContent = T("sending");
      // sendReset swallows its own failures on purpose — the answer is the same
      // either way — but a throw before the promise exists left this button
      // stuck on "Sending…" with no way forward and no error to explain it.
      sendReset(address)
        .then(function () { sentStep(T("pw_reset_sent").replace("{email}", address)); })
        .catch(function () {
          if (!document.getElementById("gate-reset")) return;
          fail(T("err_generic"));
          btn.disabled = false;
          btn.textContent = T("email_send");
        });
    };
  }

  function sentStep(message) {
    var step = stepAlone();
    step.innerHTML =
      '<p class="gate-sent">' + esc(message) + "</p>" +
      '<button class="gate-back" type="button">' + esc(T("back")) + "</button>";
    step.querySelector(".gate-back").onclick = backToChoices;
  }

  /** The passwordless way in, kept for anyone who has never set a password or
   *  cannot remember one. */
  function codeRequestStep(email) {
    var step = stepAlone();
    step.innerHTML =
      '<form class="gate-form" id="gate-otp" novalidate>' +
        '<input type="email" id="gate-otp-in" autocomplete="email" inputmode="email" ' +
          'placeholder="' + esc(T("email_ph")) + '" value="' + esc(email || "") + '" required>' +
        "<button type=\"submit\">" + esc(T("email_send")) + "</button>" +
      "</form>" +
      '<div class="gate-err" id="gate-err"></div>' +
      '<button class="gate-back" type="button">' + esc(T("back")) + "</button>";

    step.querySelector(".gate-back").onclick = function () { emailStep("in", email); };
    var input = document.getElementById("gate-otp-in");
    input.focus();
    document.getElementById("gate-otp").onsubmit = function (e) {
      e.preventDefault();
      var address = input.value.trim();
      if (!looksLikeEmail(address)) { fail(T("err_email")); return; }
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      btn.textContent = T("sending");
      sendCode(address)
        .then(function (ok) { if (ok) codeStep(address); else fail(T("err_generic")); })
        .catch(function () { fail(T("err_generic")); })
        .finally(function () {
          if (!document.getElementById("gate-otp")) return;
          btn.disabled = false;
          btn.textContent = T("email_send");
        });
    };
  }

  /** Arrived from a password-reset link: signed in already, and one step from
   *  a password that will work next time. */
  function newPasswordStep() {
    var g = gateNode();
    g.innerHTML =
      '<div class="gate" role="dialog" aria-modal="true">' +
        '<button class="gate-close" aria-label="Close">✕</button>' +
        "<h2>" + esc(T("pw_new_t")) + "</h2>" +
        '<p class="gate-lede">' + esc(T("pw_new_b")) + "</p>" +
        '<form class="gate-form stack" id="gate-newpw" novalidate>' +
          '<input type="password" id="gate-newpw-in" autocomplete="new-password" ' +
            'placeholder="' + esc(T("pw_new_ph")) + '" required>' +
          "<button type=\"submit\">" + esc(T("pw_new_save")) + "</button>" +
        "</form>" +
        '<div class="gate-err" id="gate-err"></div>' +
      "</div>";
    g.classList.add("open");
    document.body.style.overflow = "hidden";
    g.querySelector(".gate-close").onclick = closeGate;

    var input = document.getElementById("gate-newpw-in");
    input.focus();
    document.getElementById("gate-newpw").onsubmit = function (e) {
      e.preventDefault();
      if (input.value.length < 8) { fail(T("err_pw_short")); return; }
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      setPassword(input.value)
        .then(function (r) {
          if (r.ok) closeGate();
          else { fail(T(PW_ERRORS[r.code] || "err_generic")); btn.disabled = false; }
        })
        .catch(function () { fail(T("err_generic")); btn.disabled = false; });
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
    if (!box) return;
    box.textContent = message;
    box.classList.remove("ok");
  }

  /** The same line, for news that isn't bad. */
  function note(message) {
    var box = document.getElementById("gate-err");
    if (!box) return;
    box.textContent = message;
    box.classList.add("ok");
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
      // Two buttons, not one. "Sign in" is for the person who has been here
      // before; everyone else needs to be told they can start. One button
      // saying "Sign in" reads as "members only" to someone who is neither.
      // Both labels ship; CSS picks one by viewport width. Choosing in JS would
      // mean the wrong one after a rotation, and a resize listener for a word.
      slot.innerHTML =
        '<button class="signin" id="signinbtn">' + esc(T("signin")) + "</button>" +
        '<button class="signup" id="signupbtn">' +
          '<span class="lbl-wide">' + esc(T("signup")) + "</span>" +
          '<span class="lbl-narrow">' + esc(T("signup_short")) + "</span>" +
        "</button>";
      document.getElementById("signinbtn").onclick = function () { openGate("default", null); };
      document.getElementById("signupbtn").onclick = function () { openGate("signup", null); };
      return;
    }

    // The small window is one thing: the way into the account. The question
    // allowance was here for a while and is gone again — it belongs where the
    // questions are asked, and a meter in a navigation menu reads as a bill.
    var email = (me.user && me.user.email) || "";
    slot.innerHTML =
      '<div class="acct">' +
        '<button class="acct-btn" id="acctbtn" aria-haspopup="true">' +
          '<span class="acct-i">' + esc((email[0] || "?").toUpperCase()) + "</span>" +
        "</button>" +
        '<div class="acct-menu" id="acctmenu" hidden>' +
          '<div class="acct-email">' + esc(email) + "</div>" +
          // The profile first: it is the thing this menu is about, and the two
          // lists below it are ways into the same account page.
          '<button data-act="profile">' + esc(T("profile")) + "</button>" +
          '<button data-act="saved">' + esc(T("saved_list")) + '<span class="n">' + me.saved.length + "</span></button>" +
          // No number: every saved programme has a place in the deadlines view
          // now, so it would be the same figure twice in one menu.
          '<button data-act="deadlines">' + esc(T("deadlines_list")) + "</button>" +
          '<div class="acct-sep"></div>' +
          // No "new password" here any more. Changing one is account admin, it
          // lives in the account page under data & security — including for
          // someone who signed up with Google and has never had a password.
          // A five-item menu that mixes "my saved list" with "my credentials"
          // makes neither easy to find.
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
        else if (act === "password") newPasswordStep();
        // Profile, saved and deadlines are three views of the account page. It
        // is not built when accounts are off, so each falls back to what the
        // menu did before it existed.
        else if (act === "profile") { if (window.KounslyAccount) window.KounslyAccount.open("profile"); else openOnboarding(); }
        else if (act === "deadlines") { if (window.KounslyAccount) window.KounslyAccount.open("deadlines"); }
        else if (act === "saved") {
          if (window.KounslyAccount) window.KounslyAccount.open("saved");
          else if (api.onShowSaved) api.onShowSaved();
        }
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
          // Paint here, before anything is asked about *this* reader. Whether
          // accounts exist at all is everything the header needs to show a
          // "sign in" button — and every path below this line can finish
          // without an emit: a stale token whose refresh fails ends in loadMe's
          // catch, and the header then sat empty until something else happened
          // to redraw it. Which is exactly what switching the language did.
          emit();
          if (!api.enabled) return null;
          // An expired confirmation or reset link: say so rather than dropping
          // them on a page that looks like it ignored the click.
          if (arrivalType === "error") { emit(); openGate("default", null); return null; }
          if (justReturned) {
            // A reset link signs them in *and* means they came to change the
            // password. Finish the sign-in first, then ask for the new one.
            var recovery = arrivalType === "recovery";
            return arrived().then(function (r) { if (recovery) newPasswordStep(); return r; });
          }
          return loadMe();
        })
        .catch(function () { emit(); return null; });
    },

    anonId: anonId,
    user: function () { return me && me.user; },
    signedIn: function () { return !!me; },
    reminders: function () { return !!cfg.reminders; },
    // How many programmes open in full before the wall. Two is the fallback for
    // a config that predates the setting, not a second place to change it.
    anonViews: function () { return cfg.anon_views == null ? 2 : cfg.anon_views; },
    quota: function () { return (me && me.quota) || anonQuota; },
    setQuota: function (q) { if (me) me.quota = q; else anonQuota = q; emit(); },
    quotaLabel: function () {
      var q = api.quota();
      if (!q || q.remaining == null) return "";
      if (q.remaining === 1) return T("asks_left_1");
      return T("asks_left").replace("{n}", q.remaining);
    },

    fetch: authFetch,

    /* ---------- search history ----------
     *
     * Kept only for people who have an account, because it is the account
     * that makes it useful — the same list on the phone and the laptop. A
     * signed-out visitor's searches stay in their own browser and nowhere else.
     */
    history: function () { return (me && me.history) || []; },

    rememberSearch: function (q, params) {
      if (!me || !q) return Promise.resolve();
      var recent = api.history();
      // Already at the top: re-running the search you are already looking at
      // is not new information, and a write per keystroke-driven re-search is
      // a lot of writes.
      if (recent.length && recent[0].q === q && recent[0].params === params) return Promise.resolve();
      return authFetch("/api/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: q, params: params || "" })
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && me) { me.history = d.history; emit(); } })
        .catch(function () {});
    },

    forgetSearch: function (q) {
      if (!me) return Promise.resolve();
      return authFetch("/api/history" + (q ? "?q=" + encodeURIComponent(q) : ""), { method: "DELETE" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d && me) { me.history = d.history; emit(); } })
        .catch(function () {});
    },

    isSaved: isSaved,
    isWatched: isWatched,
    toggleSaved: function (uid) { return toggle("saved", uid); },
    toggleWatched: function (uid) { return toggle("watch", uid); },
    savedUids: function () { return me ? me.saved.slice() : pending().saved.slice(); },
    watchedUids: function () { return me ? me.watched.slice() : []; },

    /* ---------- the account page ----------
     *
     * These are the only writes that are not a star: a profile, a note on a
     * saved programme, and leaving. Each one absorbs the payload the API
     * returns, so nothing here has to guess what the row now says.
     */

    /** Everything the reader added to a saved programme. */
    savedMeta: function (uid) {
      var all = (me && me.saved_meta) || {};
      return all[uid] || { note: "", state: null };
    },

    saveProfile: function (patch) {
      if (!me) return Promise.resolve(null);
      return authFetch("/api/me", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (d) { me = d; emit(); return d; });
    },

    /** `quiet` absorbs the answer without redrawing. A note is saved when the
     *  box loses focus, and redrawing there would tear the box the reader is
     *  still looking at out from under the words they just typed. */
    annotateSaved: function (uid, patch, quiet) {
      if (!me) return Promise.resolve(null);
      return authFetch("/api/saved/" + encodeURIComponent(uid), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch)
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (d) { me = d; if (!quiet) emit(); return d; });
    },

    /** The export is a download, not a fetch: the browser has to save the file,
     *  and it needs the token, so the request is made here and handed over as a
     *  blob rather than as a link the browser would open unauthenticated. */
    exportData: function () {
      if (!me) return Promise.resolve(null);
      return authFetch("/api/me/export")
        .then(function (r) { return r.ok ? r.blob() : Promise.reject(r); })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "kounsly-" + new Date().toISOString().slice(0, 10) + ".json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          return true;
        });
    },

    /** Erase the data and sign out. The sign-out is not optional: leaving a
     *  session open against a row that no longer exists would recreate an empty
     *  account on the next request. */
    deleteAccount: function () {
      if (!me) return Promise.resolve(null);
      return authFetch("/api/me", { method: "DELETE" })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function () { signOut(); return true; });
    },

    /** Run `fn` whenever the account state changes. init() takes the page's own
     *  listener; this is for anything built after boot. */
    onChange: function (fn) { if (fn) listeners.push(fn); },

    /** Ask for an account for a stated reason, and run `then` once there is
     *  one. Already signed in, `then` runs immediately — callers never have to
     *  branch on it. */
    require: function (reason, then) {
      if (!cfg.enabled || me) { if (then) then(); return; }
      openGate(reason, then);
    },
    openGate: openGate,
    openProfile: openOnboarding,
    newPassword: newPasswordStep,
    signOut: signOut,
    /** Redraw everything that depends on the account — the page calls this when
     *  the language changes, since the header and the wall are translated too. */
    refresh: emit,
    T: T
  };

  window.KounslyAuth = api;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeGate(); });
})();
