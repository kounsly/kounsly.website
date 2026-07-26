/* Kounsly — the account page.
 *
 * Everything about a person used to live in a dropdown: three menu items, a
 * modal written as an onboarding, and a saved list that was really a filter on
 * the results. None of it could be looked at — only triggered. This is the one
 * place where it is all visible at once, and where the two things the account
 * page owes a person exist at all: a copy of their data, and a way out.
 *
 * The page has no router, so this is a view rather than a URL — same decision
 * the saved list already made. It does claim a hash (#account/profile), which
 * costs nothing and means the back button leaves the account instead of
 * leaving the site.
 *
 * Programme cards are borrowed from app.js rather than reimplemented: the saved
 * list has to be the same card as the search result, including the star, the
 * eligibility line and the deadline that belongs to this reader. A second
 * implementation would drift, and the first thing to drift would be whose
 * deadline is shown.
 */
(function () {
  "use strict";

  var A = window.KounslyAuth;
  if (!A) return;

  function P() { return window.KounslyApp || {}; }          // the page's own helpers
  function lang() { return localStorage.getItem("kounsly.lang") || "uk"; }

  var STR = {
    uk: {
      title_profile: "Профіль", title_saved: "Збережені", title_deadlines: "Дедлайни", title_data: "Дані й безпека",
      lede_profile: "Кожне поле тут щось робить: вирішує, який дедлайн твій, чи вистачає твоїх балів і з чого починається пошук. Порожні поля нічого не ламають — просто менше підказок.",
      lede_saved: "Не фільтр видачі, а робочий список: де ти з кожною програмою і що про неї зрозуміла.",
      lede_deadlines: "Тільки програми, за дедлайнами яких ти стежиш. Твоя дата підсвічена — решта лишаються видимими, бо бачити тільки свою небезпечно, якщо профіль неточний.",
      lede_data: "Усе, що ми про тебе зберігаємо, можна забрати одним файлом або стерти назавжди.",
      back: "← До пошуку", since: "з {d}", plan_free: "Безкоштовний план", plan_pro: "Pro",

      s_who: "Хто ти",
      b_who: "Громадянство вирішує, який із дедлайнів твій. Це не дрібниця: буває, що для не-ЄС дата на чотири місяці раніша, ніж для ЄС, на тій самій сторінці.",
      s_edu: "Освіта", b_edu: "Познач, що вже завершено. Програми, куди беруть тільки після наступного рівня, перестануть плутати видачу.",
      s_lang: "Мови", b_lang: "Самооцінка пом'якшує пошук. Бал сертифіката вмикає точну перевірку — «тобі вистачає» або «бракує 0.5».",
      s_where: "Куди і коли", b_where: "Стає початковим станом фільтрів у пошуку. Зняти можна одним кліком — ми нічого не ховаємо назавжди.",

      f_field: "Спеціальність", f_inst: "Заклад", f_year: "Рік випуску",
      f_gpa: "Середній бал", f_scale: "Шкала", f_intake: "Вступ", f_level: "Рівень",
      f_budget: "Плата за навчання — стеля на рік", f_eng: "Англійська — як ти сама її оцінюєш",
      ph_field: "Комп'ютерні науки", ph_inst: "Університет або школа", ph_year: "2025",
      sc_100: "зі 100", sc_12: "12-бальна", sc_5: "5-бальна", sc_4: "GPA 4.0",
      conv: "≈ <b>{de}</b> за німецькою шкалою · ≈ <b>{gpa}</b> GPA",
      conv_note: "Приблизно, щоб орієнтуватись. Офіційний перерахунок робить університет або uni-assist, і він може відрізнятися.",
      conv_empty: "Введи бал і шкалу — покажемо, як це виглядає приблизно за німецькою шкалою.",
      eng_unknown: "Не знаю", tests: "Іспити з англійської",
      intake_2026_fall: "Осінь 2026", intake_2027_spring: "Весна 2027", intake_2027_fall: "Осінь 2027", intake_undecided: "Ще не вирішила",
      lvl_bachelor: "Бакалаврат", lvl_master: "Магістратура", lvl_any: "Будь-який",
      bud_0: "Тільки без плати", bud_3000: "до €3 000", bud_8000: "до €8 000", bud_15000: "до €15 000", bud_any: "Байдуже",
      save: "Зберегти профіль", saved_ok: "Збережено", save_err: "Не вдалося зберегти. Спробуй ще раз.",
      meter: "Заповнено {n} з {t}",
      meter_more: "Додай бал і рівень вступу — і замість «вимоги не вказані» на картках буде видно, чи ти проходиш.",
      meter_done: "Профіль повний. Картки рахують твої дедлайни й вимоги за ним.",

      st_applying: "Подаюсь", st_thinking: "Думаю", st_dropped: "Відпало",
      note_add: "+ Додати нотатку", note_edit: "Нотатка", note_ph: "Що ти зрозуміла про цю програму? Нотатка залишиться, навіть якщо програма зникне з каталогу.",
      note_saving: "Зберігаю…", note_saved: "Збережено",
      sort_deadline: "Спочатку найближчий дедлайн", sort_added: "Спочатку додані останніми",
      empty_saved: "Тут поки порожньо — тисни ★ на будь-якій програмі.",
      empty_watch: "Ти ще не стежиш за жодним дедлайном. Кнопка «нагадати» — у картці програми.",
      count_saved: "{n} програм", applying_n: "{n} подаюсь",

      s_login: "Вхід", f_email: "Пошта", f_pw: "Пароль", pw_change: "Новий пароль",
      s_export: "Забрати свої дані",
      b_export: "Один JSON: профіль, збережені програми з нотатками, дедлайни, історія пошуку, лічильник питань. Чого немає у файлі — того ми про тебе й не зберігаємо.",
      export: "Завантажити JSON", export_err: "Не вдалося зібрати файл. Спробуй ще раз.",
      s_delete: "Видалити всі свої дані",
      b_delete: "Зникають профіль, збережені, нотатки, дедлайни й історія — назавжди, без кошика. Каталог це не чіпає: пошуком можна користуватися й без акаунта.",
      b_delete_auth: "Твоя пошта лишиться у списку входів Supabase — стерти її можемо тільки ключем, який відкриває всі акаунти проєкту, і такого ключа ми на сервері не тримаємо. Але за нею більше не буде жодних твоїх даних.",
      del: "Видалити всі дані", del_word: "ВИДАЛИТИ",
      del_confirm: "Скасувати це неможливо. Щоб підтвердити, введи <b>{w}</b> у полі нижче.",
      del_go: "Так, видалити все", del_cancel: "Скасувати", del_err: "Не вдалося видалити. Спробуй ще раз.",
      asks_month: "Питань цього місяця", asks_used: "<b>{used}</b> з {limit} використано", asks_left: "лишилось {n}"
    },
    en: {
      title_profile: "Profile", title_saved: "Saved", title_deadlines: "Deadlines", title_data: "Data & security",
      lede_profile: "Every field here does something: which deadline is yours, whether your scores are enough, and where the search starts from. Empty fields break nothing — you just get fewer answers.",
      lede_saved: "Not a filter on the results: a working list of where you are with each programme and what you worked out about it.",
      lede_deadlines: "Only programmes you asked to be reminded about. Your date is highlighted; the others stay visible, because showing only yours is dangerous if the profile is wrong.",
      lede_data: "Everything we hold about you, in one file you can keep — or erase for good.",
      back: "← Back to search", since: "since {d}", plan_free: "Free plan", plan_pro: "Pro",

      s_who: "Who you are",
      b_who: "Citizenship decides which deadline is yours. Not a detail: the same page can carry a non-EU date four months earlier than the EU one.",
      s_edu: "Education", b_edu: "Tick what you have finished. Programmes that only admit from the next level up stop cluttering the results.",
      s_lang: "Languages", b_lang: "A self-assessment softens the search. A test score switches on the exact check — \"enough\" or \"0.5 short\".",
      s_where: "Where and when", b_where: "Becomes the opening position of the filters. One click clears it — nothing is hidden for good.",

      f_field: "Speciality", f_inst: "Institution", f_year: "Graduated",
      f_gpa: "Average mark", f_scale: "Scale", f_intake: "Intake", f_level: "Level",
      f_budget: "Tuition ceiling per year", f_eng: "English, as you'd rate it yourself",
      ph_field: "Computer science", ph_inst: "University or school", ph_year: "2025",
      sc_100: "out of 100", sc_12: "12-point", sc_5: "5-point", sc_4: "GPA 4.0",
      conv: "≈ <b>{de}</b> on the German scale · ≈ <b>{gpa}</b> GPA",
      conv_note: "An approximation, to get your bearings. The official conversion is done by the university or uni-assist and may differ.",
      conv_empty: "Enter a mark and its scale and we'll show roughly what it looks like on the German scale.",
      eng_unknown: "Not sure", tests: "English tests",
      intake_2026_fall: "Autumn 2026", intake_2027_spring: "Spring 2027", intake_2027_fall: "Autumn 2027", intake_undecided: "Not decided",
      lvl_bachelor: "Bachelor", lvl_master: "Master", lvl_any: "Any",
      bud_0: "No tuition only", bud_3000: "up to €3,000", bud_8000: "up to €8,000", bud_15000: "up to €15,000", bud_any: "No limit",
      save: "Save profile", saved_ok: "Saved", save_err: "Couldn't save. Try again.",
      meter: "{n} of {t} filled in",
      meter_more: "Add your mark and the level you're applying for, and the cards will say whether you qualify instead of \"not stated\".",
      meter_done: "Profile complete. The cards work out your deadlines and requirements from it.",

      st_applying: "Applying", st_thinking: "Thinking", st_dropped: "Dropped",
      note_add: "+ Add a note", note_edit: "Note", note_ph: "What did you work out about this one? The note survives the programme leaving the catalogue.",
      note_saving: "Saving…", note_saved: "Saved",
      sort_deadline: "Nearest deadline first", sort_added: "Most recently added first",
      empty_saved: "Nothing here yet — hit ★ on any programme.",
      empty_watch: "You're not following any deadline yet. The reminder button is on the programme card.",
      count_saved: "{n} programmes", applying_n: "{n} applying",

      s_login: "Sign-in", f_email: "E-mail", f_pw: "Password", pw_change: "New password",
      s_export: "Take your data",
      b_export: "One JSON: profile, saved programmes with notes, deadlines, search history, question counter. What isn't in the file is what we don't keep.",
      export: "Download JSON", export_err: "Couldn't build the file. Try again.",
      s_delete: "Delete all your data",
      b_delete: "Profile, saved list, notes, deadlines and history — gone for good, no bin to recover from. The catalogue is untouched: search works without an account.",
      b_delete_auth: "Your address stays in Supabase's own sign-in list — removing it needs a key that opens every account in the project, and we don't keep one on the server. Nothing of yours will be behind it.",
      del: "Delete all data", del_word: "DELETE",
      del_confirm: "This cannot be undone. Type <b>{w}</b> below to confirm.",
      del_go: "Yes, delete everything", del_cancel: "Cancel", del_err: "Couldn't delete. Try again.",
      asks_month: "Questions this month", asks_used: "<b>{used}</b> of {limit} used", asks_left: "{n} left"
    }
  };

  /* Falls through to auth.js's dictionary for anything the onboarding already
     names — the citizenship question is the same question here, and asking it
     in two slightly different wordings is how a product starts sounding like
     two products. */
  function T(k) {
    var own = (STR[lang()] && STR[lang()][k]) || (STR.uk && STR.uk[k]);
    if (own) return own;
    var shared = A.T(k);
    return shared === k ? k : shared;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- state ---------- */

  var opened = false;
  var section = "profile";
  var draft = null;             // the profile being edited, before it is saved
  var programs = {};            // uid -> catalogue row, cached across sections

  var EDU = ["school", "bachelor", "master"];
  var SCALES = ["100", "12", "5", "4"];
  var CEFR = ["A2", "B1", "B2", "C1", "C2"];
  var INTAKES = ["2026-fall", "2027-spring", "2027-fall", "undecided"];
  var LEVELS = ["bachelor", "master", "any"];
  // The same buckets the budget filter offers, so a saved ceiling maps onto it
  // exactly rather than being rounded to something the reader never chose.
  var BUDGETS = [0, 3000, 8000, 15000];

  function root() { return document.getElementById("account"); }

  function profile() {
    var u = A.user();
    return (u && u.profile) || {};
  }

  /* ---------- open / close ---------- */

  function open(sec) {
    // Nothing to show without accounts, and the sign-in box would be a door to
    // a room that isn't built.
    if (!A.enabled) return;
    if (!A.signedIn()) { A.openGate("default", function () { open(sec); }); return; }
    section = sec || section;
    opened = true;
    draft = null;
    document.body.setAttribute("data-view", "account");
    root().hidden = false;
    if (location.hash !== "#account/" + section) {
      history.pushState({ account: section }, "", "#account/" + section);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    paint();
  }

  function close(fromPop) {
    if (!root()) return;
    opened = false;
    document.body.removeAttribute("data-view");
    root().hidden = true;
    root().innerHTML = "";
    if (!fromPop && location.hash.indexOf("#account") === 0) history.pushState({}, "", location.pathname);
  }

  // Back out of the account rather than off the site. Anything that puts a hash
  // on the URL has to survive being landed on directly, so this also opens the
  // account when someone arrives with #account already in the address.
  window.addEventListener("popstate", function () {
    if (location.hash.indexOf("#account") === 0) {
      if (!A.signedIn()) return;                  // a hash is not a session
      var sec = location.hash.split("/")[1] || "profile";
      if (opened && sec === section) return;
      section = sec;
      opened = true;
      document.body.setAttribute("data-view", "account");
      root().hidden = false;
      paint();
    } else if (opened) {
      close(true);
    }
  });

  /* ---------- shell ---------- */

  function paint() {
    if (!opened) return;
    var box = root();
    box.innerHTML = "";
    box.appendChild(rail());
    var main = el("div", "ac-main");
    box.appendChild(main);

    var head = el("div", "ac-head");
    head.appendChild(el("h1", null, T("title_" + section)));
    head.appendChild(el("p", null, T("lede_" + section)));
    main.appendChild(head);

    if (section === "profile") paintProfile(main);
    else if (section === "saved") paintSaved(main);
    else if (section === "deadlines") paintDeadlines(main);
    else paintData(main);
  }

  function rail() {
    var u = A.user() || {}, nav = el("nav", "ac-rail");
    nav.setAttribute("aria-label", T("title_profile"));

    var who = el("div", "ac-who");
    who.appendChild(el("div", "mail", u.email || ""));
    if (u.created_at) who.appendChild(el("div", "since", T("since").replace("{d}", niceDate(u.created_at))));
    who.appendChild(el("span", "ac-plan", u.plan === "pro" ? T("plan_pro") : T("plan_free")));
    nav.appendChild(who);

    [["profile", null], ["saved", A.savedUids().length], ["deadlines", A.watchedUids().length], ["data", null]]
      .forEach(function (pair) {
        var b = el("button", "ac-nav", T("title_" + pair[0]));
        b.type = "button";
        b.setAttribute("aria-current", pair[0] === section ? "true" : "false");
        if (pair[1] != null) b.appendChild(el("span", "n", String(pair[1])));
        b.onclick = function () { open(pair[0]); };
        nav.appendChild(b);
      });

    var back = el("button", "ac-nav ac-back", T("back"));
    back.type = "button";
    back.onclick = function () { close(); };
    nav.appendChild(back);
    return nav;
  }

  function niceDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso.slice(0, 10);
    return d.toLocaleDateString(lang() === "uk" ? "uk-UA" : "en-GB",
                                { day: "numeric", month: "long", year: "numeric" });
  }

  function pane(parent, titleKey, ledeKey) {
    var p = el("section", "ac-pane");
    if (titleKey) p.appendChild(el("h2", null, T(titleKey)));
    if (ledeKey) p.appendChild(el("p", "lede", T(ledeKey)));
    parent.appendChild(p);
    return p;
  }

  /** A row of one-tap choices, in the shape the onboarding already uses. */
  function choices(parent, labelKey, values, chosen, onPick, labeller) {
    if (labelKey) parent.appendChild(el("span", "ac-lbl", T(labelKey)));
    var box = el("div", "ac-opts");
    values.forEach(function (v) {
      var b = el("button", "ob-opt" + (labeller === cefrLabel ? " lvl" : ""), labeller(v));
      b.type = "button";
      b.setAttribute("aria-pressed", String(v === chosen));
      if (v === chosen) b.classList.add("on");
      b.onclick = function () { onPick(v === chosen ? null : v); };
      box.appendChild(b);
    });
    parent.appendChild(box);
    return box;
  }

  function cefrLabel(v) { return v === null ? T("eng_unknown") : v; }

  /* ---------- profile ---------- */

  function paintProfile(main) {
    if (!draft) {
      draft = {};
      var p = profile();
      Object.keys(p).forEach(function (k) { draft[k] = p[k]; });
    }
    var redraw = function () { paint(); };
    var set = function (k, v) { draft[k] = v; redraw(); };

    /* how much is filled in, and what the next field buys */
    var filled = 0, wanted = ["citizenship", "status", "education", "field", "grad_year",
                              "gpa", "english_self", "ielts", "intake", "want_level", "budget_max"];
    wanted.forEach(function (k) { if (draft[k] !== null && draft[k] !== undefined && draft[k] !== "") filled++; });
    var pct = Math.round((filled / wanted.length) * 100);
    var meter = el("section", "ac-pane ac-meter");
    var ring = el("div", "ac-ring");
    ring.style.setProperty("--p", pct);
    ring.appendChild(el("b", null, pct + "%"));
    meter.appendChild(ring);
    var txt = el("div", "txt");
    txt.appendChild(el("b", null, T("meter").replace("{n}", filled).replace("{t}", wanted.length)));
    txt.appendChild(el("p", null, filled === wanted.length ? T("meter_done") : T("meter_more")));
    meter.appendChild(txt);
    main.appendChild(meter);

    /* who you are */
    var who = pane(main, "s_who", "b_who");
    choices(who, "ob_cit", ["UA", "EU", "OTHER"], draft.citizenship || null,
            function (v) { set("citizenship", v); }, function (v) { return A.T("ob_cit_" + v); });
    who.appendChild(el("hr", "ac-rule"));
    choices(who, "ob_status", ["none", "protection"], draft.status || null,
            function (v) { set("status", v); }, function (v) { return A.T("ob_status_" + v); });
    if (draft.status === "protection") {
      // The one answer we refuse to act on, said in the same words as the
      // onboarding says it.
      who.appendChild(el("div", "ob-note", A.T("ob_note")));
    }

    /* education: a ladder. Ticking "bachelor" means school is done too, so the
       three rows are one value, not three — which is also what the column is. */
    var edu = pane(main, "s_edu", "b_edu");
    var rank = EDU.indexOf(draft.education || "");
    EDU.forEach(function (level, i) {
      var b = el("button", "ac-edu");
      b.type = "button";
      b.setAttribute("aria-pressed", String(i <= rank));
      b.appendChild(el("span", "ac-tick", "✓"));
      b.appendChild(el("span", "nm", A.T("ob_edu_" + level)));
      b.onclick = function () { set("education", i === rank ? (EDU[i - 1] || null) : level); };
      edu.appendChild(b);
    });

    edu.appendChild(el("hr", "ac-rule"));
    var row = el("div", "ac-row");
    row.appendChild(textField("f_field", "field", "ph_field"));
    row.appendChild(textField("f_inst", "institution", "ph_inst"));
    row.appendChild(numField("f_year", "grad_year", "ph_year", true));
    edu.appendChild(row);

    edu.appendChild(el("hr", "ac-rule"));
    edu.appendChild(el("span", "ac-lbl", T("f_gpa")));
    var gpa = el("div", "ac-gpa");
    var mark = numField(null, "gpa", "", false);
    mark.classList.add("narrow");
    gpa.appendChild(mark);
    var scaleWrap = el("div", "ac-fld narrow");
    var scale = el("select");
    SCALES.forEach(function (s) {
      var o = el("option", null, T("sc_" + s));
      o.value = s;
      scale.appendChild(o);
    });
    scale.value = draft.gpa_scale || "100";
    scale.onchange = function () { set("gpa_scale", scale.value); };
    scaleWrap.appendChild(scale);
    gpa.appendChild(scaleWrap);
    gpa.appendChild(conversion());
    edu.appendChild(gpa);

    /* languages */
    var langs = pane(main, "s_lang", "b_lang");
    choices(langs, "f_eng", CEFR, draft.english_self || null,
            function (v) { set("english_self", v); }, cefrLabel);
    langs.appendChild(el("hr", "ac-rule"));
    langs.appendChild(el("span", "ac-lbl", T("tests")));
    var tests = el("div", "ac-row");
    tests.appendChild(numField(null, "ielts", "IELTS", false));
    tests.appendChild(numField(null, "toefl", "TOEFL", true));
    langs.appendChild(tests);

    /* where and when */
    var where = pane(main, "s_where", "b_where");
    choices(where, "f_intake", INTAKES, draft.intake || null,
            function (v) { set("intake", v); }, function (v) { return T("intake_" + v.replace("-", "_")); });
    where.appendChild(el("hr", "ac-rule"));
    choices(where, "f_level", LEVELS, draft.want_level || null,
            function (v) { set("want_level", v); }, function (v) { return T("lvl_" + v); });
    where.appendChild(el("hr", "ac-rule"));
    choices(where, "f_budget", BUDGETS.concat([null]),
            draft.budget_max === null || draft.budget_max === undefined ? null : Number(draft.budget_max),
            function (v) { set("budget_max", v); },
            function (v) { return v === null ? T("bud_any") : T("bud_" + v); });

    /* save */
    var actions = el("section", "ac-pane");
    var save = el("button", "btn primary", T("save"));
    save.type = "button";
    save.style.width = "100%";
    var msg = el("span", "ac-saved-msg");
    save.onclick = function () {
      save.disabled = true;
      msg.textContent = "";
      A.saveProfile(patch())
        .then(function () {
          save.disabled = false;
          msg.textContent = T("saved_ok");
          draft = null;
          if (P().applyProfileDefaults) P().applyProfileDefaults();
        })
        .catch(function () { save.disabled = false; msg.textContent = T("save_err"); });
    };
    actions.appendChild(save);
    actions.appendChild(msg);
    main.appendChild(actions);
  }

  /** Only the fields the profile owns, and nulls kept as nulls: clearing a
   *  score is a statement, not an omission. */
  function patch() {
    var out = {};
    ["citizenship", "status", "education", "ielts", "toefl", "field", "institution",
     "grad_year", "gpa", "gpa_scale", "english_self", "intake", "want_level", "budget_max"]
      .forEach(function (k) {
        var v = draft[k];
        out[k] = v === "" || v === undefined ? null : v;
      });
    return out;
  }

  function textField(labelKey, key, phKey) {
    var box = el("div", "ac-fld");
    if (labelKey) box.appendChild(el("span", "ac-lbl", T(labelKey)));
    var input = el("input");
    input.type = "text";
    input.value = draft[key] == null ? "" : draft[key];
    if (phKey) input.placeholder = T(phKey);
    // Kept out of the redraw: repainting on every keystroke would move the
    // caret to the end of the box on the second letter.
    input.oninput = function () { draft[key] = input.value; };
    box.appendChild(input);
    return box;
  }

  function numField(labelKey, key, ph, whole) {
    var box = el("div", "ac-fld");
    if (labelKey) box.appendChild(el("span", "ac-lbl", T(labelKey)));
    var input = el("input", "num");
    input.type = "text";
    input.inputMode = whole ? "numeric" : "decimal";
    input.placeholder = ph && ph.indexOf("ph_") === 0 ? T(ph) : ph || "";
    input.value = draft[key] == null ? "" : draft[key];
    input.setAttribute("aria-label", ph || key);
    input.oninput = function () {
      var raw = input.value.replace(",", ".").trim();
      var n = whole ? parseInt(raw, 10) : parseFloat(raw);
      draft[key] = raw === "" || isNaN(n) ? null : n;
      if (key === "gpa") repaintConversion();
    };
    box.appendChild(input);
    return box;
  }

  /* The mark, said in a scale a German university uses — as an approximation,
     labelled as one, and never written back. A converted grade presented as
     fact is exactly the kind of invented number this product exists not to
     produce. */
  function conversion() {
    var box = el("div", "ac-conv");
    box.id = "ac-conv";
    fillConversion(box);
    return box;
  }

  function repaintConversion() {
    var box = document.getElementById("ac-conv");
    if (box) fillConversion(box);
  }

  function fillConversion(box) {
    var v = parseFloat(draft.gpa), scale = draft.gpa_scale || "100";
    if (isNaN(v)) { box.textContent = T("conv_empty"); return; }
    var frac;
    if (scale === "100") frac = (v - 60) / 40;
    else if (scale === "12") frac = (v - 6) / 6;
    else if (scale === "5") frac = (v - 3) / 2;
    else frac = (v - 2) / 2;
    frac = Math.max(0, Math.min(1, frac));
    box.innerHTML = T("conv").replace("{de}", (4 - frac * 3).toFixed(1))
                             .replace("{gpa}", (2 + frac * 2).toFixed(1)) +
                    "<small>" + esc(T("conv_note")) + "</small>";
  }

  /* ---------- saved ---------- */

  function paintSaved(main) {
    var uids = A.savedUids();
    var tools = el("div", "ac-tools");
    var sort = el("select");
    [["added", "sort_added"], ["deadline", "sort_deadline"]].forEach(function (p) {
      var o = el("option", null, T(p[1]));
      o.value = p[0];
      sort.appendChild(o);
    });
    sort.style.width = "auto";
    tools.appendChild(sort);
    tools.appendChild(el("span", "sp"));
    var applying = uids.filter(function (u) { return A.savedMeta(u).state === "applying"; }).length;
    var count = el("span", "count");
    count.textContent = T("count_saved").replace("{n}", uids.length) +
                        (applying ? " · " + T("applying_n").replace("{n}", applying) : "");
    tools.appendChild(count);
    main.appendChild(tools);

    var list = el("div", "ac-list");
    main.appendChild(list);

    if (!uids.length) { list.appendChild(el("div", "ac-empty", T("empty_saved"))); return; }

    withPrograms(uids, function (rows) {
      var order = rows.slice();
      sort.onchange = function () {
        if (sort.value === "deadline") {
          order = rows.slice().sort(function (a, b) {
            var da = a.next_deadline == null ? 9999 : a.next_deadline;
            var db = b.next_deadline == null ? 9999 : b.next_deadline;
            return da - db;
          });
        } else {
          order = rows.slice();
        }
        draw();
      };
      function draw() {
        list.innerHTML = "";
        order.forEach(function (row) { list.appendChild(savedItem(row)); });
      }
      draw();
    }, list);
  }

  function savedItem(row) {
    var meta = A.savedMeta(row.uid);
    var item = el("div", "ac-item");
    item.setAttribute("data-state", meta.state || "");
    if (P().card) item.appendChild(P().card(row));

    var strip = el("div", "ac-strip");
    ["applying", "thinking", "dropped"].forEach(function (v) {
      var b = el("button", "ac-state", T("st_" + v));
      b.type = "button";
      b.setAttribute("data-v", v);
      b.setAttribute("aria-pressed", String(meta.state === v));
      b.onclick = function () {
        A.annotateSaved(row.uid, { state: meta.state === v ? null : v }, true).then(paint);
      };
      strip.appendChild(b);
    });

    var toggle = el("button", "ac-notebtn", meta.note ? T("note_edit") : T("note_add"));
    toggle.type = "button";
    strip.appendChild(toggle);
    item.appendChild(strip);

    var note = el("textarea", "ac-note");
    note.placeholder = T("note_ph");
    note.value = meta.note || "";
    note.hidden = !meta.note;
    item.appendChild(note);

    toggle.onclick = function () {
      note.hidden = !note.hidden;
      if (!note.hidden) note.focus();
    };

    // Saved when the box loses focus rather than on a button: this is a note to
    // oneself, and asking someone to press "save" on their own handwriting is
    // how notes end up lost.
    var saved = meta.note || "";
    note.onblur = function () {
      if (note.value === saved) return;
      saved = note.value;
      var flag = el("span", "ac-saving", T("note_saving"));
      strip.appendChild(flag);
      A.annotateSaved(row.uid, { note: note.value }, true)
        .then(function () { flag.textContent = T("note_saved"); setTimeout(function () { flag.remove(); }, 1200); })
        .catch(function () { flag.remove(); });
    };
    return item;
  }

  /* ---------- deadlines ---------- */

  function paintDeadlines(main) {
    var uids = A.watchedUids();
    var box = pane(main, null, null);
    if (!uids.length) { box.appendChild(el("div", "ac-empty", T("empty_watch"))); return; }

    withPrograms(uids, function (rows) {
      box.innerHTML = "";
      var lines = [];
      rows.forEach(function (row) {
        var own = P().ownDeadlines ? P().ownDeadlines(row.deadlines) : row.deadlines;
        var next = P().nextDeadline ? P().nextDeadline(own) : null;
        if (!next) return;
        lines.push({ row: row, d: next, mine: P().isMyDeadline ? P().isMyDeadline(next) : false });
      });
      lines.sort(function (a, b) { return a.d.days - b.d.days; });

      if (!lines.length) { box.appendChild(el("div", "ac-empty", T("empty_watch"))); return; }

      lines.forEach(function (line) {
        var r = el("div", "ac-dl" + (line.mine ? " mine" : ""));
        var when = el("div", "when");
        when.appendChild(el("b", null, P().dateLabel(line.d)));
        when.appendChild(el("span", null, P().daysLabel(line.d.days)));
        r.appendChild(when);
        var body = el("div", "body");
        body.appendChild(el("div", "t", line.row.title));
        var where = P().countryName ? P().countryName(line.row.country) : line.row.country;
        body.appendChild(el("div", "s", [line.row.university, where].filter(Boolean).join(" · ")));
        if (line.mine && line.d.applies_to) {
          body.appendChild(el("span", "ac-who-tag", P().deadlineWho(line.d.applies_to)));
        }
        r.appendChild(body);
        box.appendChild(r);
      });
    }, box);
  }

  /* ---------- data and security ---------- */

  function paintData(main) {
    var u = A.user() || {};

    var login = pane(main, "s_login", null);
    kv(login, "f_email", u.email || "");
    var pw = kv(login, "f_pw", "");
    var pwBtn = el("button", "btn", T("pw_change"));
    pwBtn.type = "button";
    pwBtn.onclick = function () { A.newPassword(); };
    pw.appendChild(pwBtn);

    var exp = pane(main, "s_export", "b_export");
    var expBtn = el("button", "btn", T("export"));
    expBtn.type = "button";
    var expMsg = el("span", "ac-saved-msg");
    expBtn.onclick = function () {
      expBtn.disabled = true;
      A.exportData()
        .then(function () { expBtn.disabled = false; })
        .catch(function () { expBtn.disabled = false; expMsg.textContent = T("export_err"); });
    };
    exp.appendChild(expBtn);
    exp.appendChild(expMsg);

    /* Two steps, and the second one asks for a word. Not friction for its own
       sake: this is the only button on the site that destroys something. */
    var danger = pane(main, "s_delete", "b_delete");
    danger.classList.add("danger");
    danger.appendChild(el("p", "ac-hint", T("b_delete_auth")));
    var start = el("button", "btn danger", T("del"));
    start.type = "button";
    danger.appendChild(start);

    var confirm = el("div", "ac-confirm");
    var q = el("p");
    q.innerHTML = T("del_confirm").replace("{w}", esc(T("del_word")));
    confirm.appendChild(q);
    var word = el("input");
    word.type = "text";
    word.placeholder = T("del_word");
    word.setAttribute("aria-label", T("del_word"));
    confirm.appendChild(word);
    var acts = el("div", "acts");
    var go = el("button", "btn danger", T("del_go"));
    go.type = "button";
    go.disabled = true;
    var cancel = el("button", "ac-quiet", T("del_cancel"));
    cancel.type = "button";
    var err = el("span", "ac-hint");
    acts.appendChild(go);
    acts.appendChild(cancel);
    acts.appendChild(err);
    confirm.appendChild(acts);
    danger.appendChild(confirm);

    word.oninput = function () { go.disabled = word.value.trim().toUpperCase() !== T("del_word"); };
    start.onclick = function () { confirm.classList.add("on"); word.focus(); };
    cancel.onclick = function () { confirm.classList.remove("on"); word.value = ""; go.disabled = true; };
    go.onclick = function () {
      go.disabled = true;
      A.deleteAccount()
        .then(function () { close(); })
        .catch(function () { go.disabled = false; err.textContent = T("del_err"); });
    };
  }

  function kv(parent, labelKey, value) {
    var row = el("div", "ac-kv");
    row.appendChild(el("span", "k", T(labelKey)));
    row.appendChild(el("span", "v", value));
    parent.appendChild(row);
    return row;
  }

  /* ---------- catalogue rows ---------- */

  /** Fetch the cards for a set of uids, once, and hand them to `then`.
   *
   *  A uid the catalogue no longer knows is simply missing from the answer —
   *  the API is built that way on purpose — so a programme disappearing from a
   *  source leaves the other four on screen instead of an error. */
  function withPrograms(uids, then, holder) {
    var missing = uids.filter(function (u) { return !programs[u]; });
    if (!missing.length) {
      then(uids.map(function (u) { return programs[u]; }).filter(Boolean));
      return;
    }
    holder.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    fetch("/api/programs?uids=" + encodeURIComponent(missing.join(",")))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        (d.items || []).forEach(function (row) { programs[row.uid] = row; });
        then(uids.map(function (u) { return programs[u]; }).filter(Boolean));
      })
      .catch(function () {
        holder.innerHTML = "";
        holder.appendChild(el("div", "ac-empty", A.T("err_generic")));
      });
  }

  /* ---------- boot ---------- */

  // Repaint on any account change: starring a programme from inside the saved
  // list has to remove it from the list it was starred in.
  A.onChange(function () { if (opened) paint(); });

  window.KounslyAccount = {
    open: open,
    close: close,
    isOpen: function () { return opened; }
  };

  // Landing straight on #account — a reload, or the back button after leaving.
  // Waits for the account itself to arrive rather than for a guessed number of
  // milliseconds: /api/me is a round trip, and on a slow connection a timer
  // fires while the answer is still in flight and decides nobody is signed in.
  if (location.hash.indexOf("#account") === 0) {
    var wanted = location.hash.split("/")[1] || "profile";
    var landed = false;
    A.onChange(function () {
      if (landed || opened || !A.signedIn()) return;
      landed = true;
      open(wanted);
    });
  }
})();
