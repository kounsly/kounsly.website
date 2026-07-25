/* Kounsly — front end over the real catalogue.
 *
 * The page previously shipped a hard-coded array of 28 illustrative programmes.
 * Everything here reads /api instead, so what a visitor sees is what the
 * connectors actually collected, with a source link under every fact.
 */
(function () {
  "use strict";

  var lang = localStorage.getItem("kounsly.lang") || "uk";
  var state = { q: "", country: "", area: "", subject: "", level: "", budget: "", free: false, sort: "match", page: 1 };
  var facets = null, current = null, asking = false;

  var STR = {
    uk: {
      h1a: "Знайди навчання за кордоном.", h1b: "Просто запитай.",
      lede: "Опиши звичайною мовою, чого хочеш. Kounsly шукає серед реальних програм — з вартістю, дедлайнами та вимогами з офіційних джерел. Без агента й комісій.",
      ph: "data science магістр англійською без плати за навчання", search: "Пошук",
      chip1: "Магістр без плати", q1: "computer science", chip2: "Інженерія", q2: "engineering",
      chip3: "Бізнес-аналітика", q3: "business analytics",
      f_region: "Країна", f_country: "Область", f_field: "Напрям", f_level: "Рівень", f_budget: "Макс. плата / рік",
      any_country: "Усі країни", any_area: "Усі області", any_subject: "Усі напрями", any_level: "Будь-який рівень", no_limit: "Без обмежень",
      freeonly: "Лише без плати за навчання", reset: "Скинути фільтри", sortlabel: "Сортування",
      sort_match: "За релевантністю", sort_tuition: "Найдешевші", sort_deadline: "Дедлайн найближче", sort_ielts: "Найнижчий IELTS",
      footer: "Kounsly — підбір англомовних програм за кордоном. Кожен факт має джерело й дату перевірки.",
      found: "знайдено", of_total: "з", programmes: "програм",
      free: "Без плати за навчання", per_year: "/ рік", per_semester: "/ семестр", not_listed: "не вказано",
      source: "Джерело:", src_checked: "перевірено",
      lvl_bachelor: "Бакалавр", lvl_master: "Магістр", lvl_phd: "PhD",
      f_tuition: "Плата за навчання", f_deadline: "Найближчий дедлайн", f_english: "Англійська", f_duration: "Тривалість",
      open: "Детальніше →", broadened: "Точного збігу не знайшлось — показую близькі результати.",
      empty_t: "Нічого не знайшлось.", empty_b: "Спробуй інші слова або послаб фільтри.",
      d_money: "Гроші", d_reqs: "Вимоги до вступу", d_lang: "Мова навчання й вимоги", d_deadlines: "Дедлайни",
      d_about: "Про програму", d_funding: "Фінансування та стипендії", d_support: "Підтримка іноземних студентів",
      d_semester: "Семестровий внесок", d_living: "Життя на місяць", d_apply: "Куди подаватися й де що шукати",
      d_housing: "Житло", d_work: "Робота під час навчання", d_org: "Як влаштоване навчання",
      d_intl: "Міжнародні елементи", d_intern: "Стажування",
      l_apply: "Подати заявку на програму", l_apply_note: "портал, який указав університет",
      l_funding: "Фінансова підтримка та стипендії", l_fee: "Семестровий внесок — деталі",
      l_living: "Вартість життя — деталі", l_reqs: "Вимоги до вступу — деталі",
      l_lang: "Мовні вимоги та сертифікати", l_housing: "Житло та гуртожитки",
      l_work: "Робота під час навчання", l_official: "Повний опис програми",
      l_official_note: "офіційна сторінка, звідки взяті всі факти вище",
      checked: "Дані з офіційного джерела, перевірено", days_left: "через {n} дн.", today: "сьогодні",
      term_winter: "зимовий", term_summer: "літній", term_rolling: "постійно",
      sel_ask: "Запитати AI про це ↗",
      ask_ph: "Спитай про цю програму…", ask_send: "Спитати",
      ask_hint: "Відповідає лише за даними цієї програми. Чого немає на офіційній сторінці — так і скаже.",
      ask_wait: "Дивлю дані програми", ask_err: "Асистент недоступний. Спробуй ще раз.",
      ask_limit: "Ліміт безкоштовних питань на годину вичерпано.",
      prev: "Назад", next: "Далі", page_of: "стор. {p} з {t}", langbtn: "UA"
    },
    en: {
      h1a: "Find your degree abroad.", h1b: "Just ask.",
      lede: "Describe what you want in plain English. Kounsly searches real programmes — tuition, deadlines and requirements from official sources. No agent, no commission.",
      ph: "data science master taught in English with no tuition", search: "Search",
      chip1: "No tuition", q1: "computer science", chip2: "Engineering", q2: "engineering",
      chip3: "Business analytics", q3: "business analytics",
      f_region: "Country", f_country: "Area", f_field: "Subject", f_level: "Level", f_budget: "Max tuition / year",
      any_country: "All countries", any_area: "All areas", any_subject: "All subjects", any_level: "Any level", no_limit: "No limit",
      freeonly: "No tuition only", reset: "Reset filters", sortlabel: "Sort",
      sort_match: "Best match", sort_tuition: "Lowest tuition", sort_deadline: "Deadline soonest", sort_ielts: "Lowest IELTS",
      footer: "Kounsly — English-taught degrees abroad. Every fact carries its source and the date we checked it.",
      found: "found", of_total: "of", programmes: "programmes",
      free: "No tuition fees", per_year: "/ year", per_semester: "/ semester", not_listed: "not listed",
      source: "Source:", src_checked: "checked",
      lvl_bachelor: "Bachelor", lvl_master: "Master", lvl_phd: "PhD",
      f_tuition: "Tuition", f_deadline: "Next deadline", f_english: "English", f_duration: "Duration",
      open: "Details →", broadened: "No exact match — showing close results.",
      empty_t: "Nothing matched.", empty_b: "Try different words or loosen the filters.",
      d_money: "Money", d_reqs: "Admission requirements", d_lang: "Teaching language & requirements", d_deadlines: "Deadlines",
      d_about: "About the programme", d_funding: "Funding & scholarships", d_support: "Support for international students",
      d_semester: "Semester contribution", d_living: "Living cost per month", d_apply: "Where to apply and where to look",
      d_housing: "Accommodation", d_work: "Working while studying", d_org: "How the programme is organised",
      d_intl: "International elements", d_intern: "Internships",
      l_apply: "Apply to this programme", l_apply_note: "the portal the university names",
      l_funding: "Funding and scholarships", l_fee: "Semester contribution — details",
      l_living: "Cost of living — details", l_reqs: "Admission requirements — details",
      l_lang: "Language requirements and certificates", l_housing: "Housing and halls of residence",
      l_work: "Working while studying", l_official: "Full programme description",
      l_official_note: "the official page every fact above comes from",
      checked: "From the official source, checked", days_left: "in {n} days", today: "today",
      term_winter: "winter", term_summer: "summer", term_rolling: "rolling",
      sel_ask: "Ask AI about this ↗",
      ask_ph: "Ask about this programme…", ask_send: "Ask",
      ask_hint: "Answers only from this programme's data. If the official page doesn't say, it will tell you so.",
      ask_wait: "Reading the programme data", ask_err: "Assistant unavailable. Try again.",
      ask_limit: "Hourly limit of free questions reached.",
      prev: "Back", next: "Next", page_of: "page {p} of {t}", langbtn: "EN"
    }
  };
  function T(k) { return (STR[lang] && STR[lang][k]) || k; }

  var COUNTRY = { DE: { uk: "Німеччина", en: "Germany", flag: "🇩🇪" }, FI: { uk: "Фінляндія", en: "Finland", flag: "🇫🇮" } };
  function countryName(code) { var c = COUNTRY[code]; return c ? c[lang] || c.en : code; }
  function countryFlag(code) { return (COUNTRY[code] || {}).flag || ""; }
  var MONTHS = { uk: ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"],
                 en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] };

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

  /* ---------- formatting ---------- */

  /** compact = the card, where the label already says "per year" and the figure
   *  is the thing being looked at. Long form is for the detail tiles. */
  function money(item, compact) {
    var free = item.tuition_free === 1 || item.tuition_eur_year === 0;
    if (free) return compact ? "€0" : T("free");
    if (item.tuition_eur_year == null) return T("not_listed");
    var n = Math.round(item.tuition_eur_year).toLocaleString(lang === "uk" ? "uk-UA" : "en-US");
    return compact ? "€" + n : "€" + n + " " + T("per_year");
  }

  function nextDeadline(deadlines) {
    if (!deadlines || !deadlines.length) return null;
    var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), best = null;
    deadlines.forEach(function (d) {
      if (!d.month || !d.day) return;
      var when = new Date(today.getFullYear(), d.month - 1, d.day);
      if (when < today) when = new Date(today.getFullYear() + 1, d.month - 1, d.day);
      var days = Math.round((when - today) / 86400000);
      if (!best || days < best.days) best = { days: days, month: d.month, day: d.day, term: d.term };
    });
    return best;
  }

  function dateLabel(d) { return d.day + " " + MONTHS[lang][d.month - 1]; }
  function daysLabel(days) { return days === 0 ? T("today") : T("days_left").replace("{n}", days); }
  function termLabel(term) { return term ? T("term_" + term) || term : ""; }

  function englishLabel(item) {
    var bits = [];
    if (item.ielts != null) bits.push("IELTS " + item.ielts);
    if (item.toefl_ibt != null) bits.push("TOEFL " + item.toefl_ibt);
    if (!bits.length && item.english_cefr) bits.push(item.english_cefr);
    return bits.join(" · ") || T("not_listed");
  }

  /* ---------- selects ---------- */

  function opt(value, label) { var o = document.createElement("option"); o.value = value; o.textContent = label; return o; }

  function buildSelects() {
    if (!facets) return;
    var s;

    s = $("f-region"); s.innerHTML = ""; s.appendChild(opt("", T("any_country")));
    facets.countries.forEach(function (c) { s.appendChild(opt(c.value, countryFlag(c.value) + " " + countryName(c.value) + " (" + c.count + ")")); });
    s.value = state.country;

    s = $("f-country"); s.innerHTML = ""; s.appendChild(opt("", T("any_area")));
    facets.areas.forEach(function (a) { s.appendChild(opt(a.value, a.value + " (" + a.count + ")")); });
    s.value = state.area;

    s = $("f-field"); s.innerHTML = ""; s.appendChild(opt("", T("any_subject")));
    facets.subjects.forEach(function (a) { s.appendChild(opt(a.value, a.value + " (" + a.count + ")")); });
    s.value = state.subject;

    s = $("f-level"); s.innerHTML = ""; s.appendChild(opt("", T("any_level")));
    facets.levels.forEach(function (l) { s.appendChild(opt(l.value, T("lvl_" + l.value) + " (" + l.count + ")")); });
    s.value = state.level;

    s = $("f-budget"); s.innerHTML = ""; s.appendChild(opt("", T("no_limit")));
    [["0", T("free")], ["3000", "≤ €3 000"], ["8000", "≤ €8 000"], ["15000", "≤ €15 000"]].forEach(function (p) { s.appendChild(opt(p[0], p[1])); });
    s.value = state.budget;

    s = $("f-sort"); s.innerHTML = "";
    [["match", "sort_match"], ["tuition", "sort_tuition"], ["deadline", "sort_deadline"], ["ielts", "sort_ielts"]]
      .forEach(function (p) { s.appendChild(opt(p[0], T(p[1]))); });
    s.value = state.sort;
  }

  function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function (n) { n.textContent = T(n.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (n) { n.placeholder = T(n.getAttribute("data-i18n-ph")); });
    document.querySelectorAll(".chip[data-qi]").forEach(function (n) { n.textContent = T("chip" + n.getAttribute("data-qi")); });
    var b = $("langbtn"); if (b) b.textContent = lang === "uk" ? "EN" : "UA";
    document.documentElement.lang = lang;
  }

  /* ---------- search ---------- */

  function params() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.country) p.set("country", state.country);
    if (state.area) p.set("area", state.area);
    if (state.subject) p.set("subject", state.subject);
    if (state.level) p.set("level", state.level);
    if (state.budget === "0") p.set("free_only", "true");
    else if (state.budget) p.set("max_tuition", state.budget);
    if (state.free) p.set("free_only", "true");
    p.set("sort", state.sort);
    p.set("page", state.page);
    return p.toString();
  }

  var searchToken = 0;
  function runSearch() {
    var list = $("list"), token = ++searchToken;
    list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    fetch("/api/search?" + params())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (token !== searchToken) return;   // a newer query already answered
        render(data);
      })
      .catch(function () {
        if (token !== searchToken) return;
        list.innerHTML = "";
        list.appendChild(el("div", "empty", T("ask_err")));
      });
  }

  function render(data) {
    var list = $("list");
    list.innerHTML = "";
    $("count").textContent = data.total.toLocaleString(lang === "uk" ? "uk-UA" : "en-US") + " " + T("programmes");

    if (data.broadened) list.appendChild(el("div", "broadened", T("broadened")));
    if (!data.items.length) {
      var box = el("div", "empty");
      box.appendChild(el("h3", null, T("empty_t")));
      box.appendChild(el("p", null, T("empty_b")));
      list.appendChild(box);
      return;
    }

    data.items.forEach(function (item) { list.appendChild(card(item)); });

    var pages = Math.ceil(data.total / data.per_page);
    if (pages > 1) list.appendChild(pager(data.page, pages));
  }

  /** Uses the page's original card classes (.top/.uni/.lvl/.facts/.fact/.k/.v/
   *  .big/.free/.soon/.note/.foot/.src/.lnk) so the typography that made these
   *  cards look good is the same — only the data behind it is real now. */
  function card(item) {
    var node = el("article", "card");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    var dl = nextDeadline(item.deadlines);
    var free = item.tuition_free === 1 || item.tuition_eur_year === 0;
    var cheap = item.tuition_eur_year != null && item.tuition_eur_year > 0 && item.tuition_eur_year <= 3000;
    var soon = dl && dl.days <= 30;

    var tuitionNote = free
      ? (item.semester_fee_raw ? "+ " + shortFee(item.semester_fee_raw) + " " + T("per_semester") : "")
      : (item.tuition_raw && !/^\s*\d/.test(item.tuition_raw) ? item.tuition_raw.slice(0, 40) : "");

    node.innerHTML =
      '<div class="top"><div>' +
          "<h3>" + esc(item.name) + "</h3>" +
          '<div class="uni">' + countryFlag(item.country) + " " + esc(item.university) +
            (item.city ? " · " + esc(item.city) : "") + "</div>" +
        "</div><span class=\"lvl\">" + esc(item.degree_title || T("lvl_" + item.degree_level)) + "</span></div>" +
      '<div class="facts">' +
        '<div class="fact"><span class="k">' + esc(T("f_tuition")) + "</span>" +
          '<span class="v big' + (free || cheap ? " free" : "") + '">' + esc(money(item, true)) + "</span>" +
          (tuitionNote ? '<span class="note">' + esc(tuitionNote) + "</span>" : "") + "</div>" +
        '<div class="fact"><span class="k">' + esc(T("f_deadline")) + "</span>" +
          '<span class="v' + (soon ? " soon" : "") + '">' + esc(dl ? dateLabel(dl) : T("not_listed")) + "</span>" +
          (dl ? '<span class="note">' + esc(soon ? daysLabel(dl.days) : (termLabel(dl.term) || "")) + "</span>" : "") + "</div>" +
        '<div class="fact"><span class="k">' + esc(T("f_english")) + "</span>" +
          '<span class="v">' + esc(englishLabel(item)) + "</span></div>" +
        '<div class="fact"><span class="k">' + esc(T("f_duration")) + "</span>" +
          '<span class="v">' + esc(item.duration_raw || T("not_listed")) + "</span></div>" +
      "</div>" +
      '<div class="foot"><span class="src">' + esc(T("source")) + " " + esc(hostOf(item.source_url)) +
        " · " + esc(T("src_checked")) + " " + esc(item.checked_at || "") + "</span>" +
        '<a class="lnk" href="#" onclick="return false">' + esc(T("open")) + "</a></div>";

    node.addEventListener("click", function () { openSheet(item.uid); });
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(item.uid); }
    });
    return node;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\d?\./, ""); } catch (e) { return ""; }
  }

  function pager(page, pages) {
    var box = el("div", "pager");
    var prev = el("button", null, T("prev")), next = el("button", null, T("next"));
    prev.disabled = page <= 1; next.disabled = page >= pages;
    prev.onclick = function () { state.page = page - 1; runSearch(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    next.onclick = function () { state.page = page + 1; runSearch(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    box.appendChild(prev);
    box.appendChild(el("span", null, T("page_of").replace("{p}", page).replace("{t}", pages)));
    box.appendChild(next);
    return box;
  }

  /* ---------- detail sheet ---------- */

  function sheetNodes() {
    var wrap = $("sheet-wrap");
    if (wrap) return { wrap: wrap, sheet: $("sheet") };
    wrap = el("div", "sheet-wrap"); wrap.id = "sheet-wrap";
    var sheet = el("div", "sheet"); sheet.id = "sheet";
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true");
    wrap.appendChild(sheet);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) closeSheet(); });
    document.body.appendChild(wrap);

    var pop = el("div", "selpop"); pop.id = "selpop"; pop.textContent = T("sel_ask");
    document.body.appendChild(pop);
    return { wrap: wrap, sheet: sheet };
  }

  function closeSheet() {
    var wrap = $("sheet-wrap");
    if (wrap) wrap.classList.remove("open");
    hidePop();
    current = null;
    document.body.style.overflow = "";
  }

  function section(title, text) {
    if (!text) return "";
    return '<div class="sec"><h3>' + esc(title) + '</h3><div class="txt">' + esc(text) + "</div></div>";
  }

  function openSheet(uid) {
    var n = sheetNodes();
    n.wrap.classList.add("open");
    document.body.style.overflow = "hidden";
    n.sheet.innerHTML = '<div class="sheet-body"><div class="skeleton"></div><div class="skeleton"></div></div>';

    fetch("/api/program/" + encodeURIComponent(uid))
      .then(function (r) { return r.json(); })
      .then(function (p) {
        current = p;
        n.sheet.innerHTML = sheetHTML(p);
        n.sheet.scrollTop = 0;
        $("sheet-close").onclick = closeSheet;
        wireAsk(p);
      });
  }

  function sheetHTML(p) {
    var dl = nextDeadline(p.deadlines);
    var free = p.tuition_free === 1 || p.tuition_eur_year === 0;

    var tiles = [
      '<div class="tile' + (free ? " free" : "") + '"><b>' + esc(T("f_tuition")) + "</b><span>" + esc(money(p)) + "</span></div>",
      '<div class="tile"><b>' + esc(T("d_semester")) + "</b><span>" + esc(p.semester_fee_raw ? shortFee(p.semester_fee_raw) : T("not_listed")) + "</span></div>",
      '<div class="tile"><b>' + esc(T("d_living")) + "</b><span>" + (p.cost_of_living_eur_month ? "≈ €" + p.cost_of_living_eur_month : esc(T("not_listed"))) + "</span></div>",
      '<div class="tile"><b>' + esc(T("f_english")) + "</b><span>" + esc(englishLabel(p)) + "</span></div>",
      '<div class="tile"><b>' + esc(T("f_duration")) + "</b><span>" + esc(p.duration_raw || T("not_listed")) + "</span></div>",
      '<div class="tile"><b>' + esc(T("f_deadline")) + "</b><span>" + (dl ? esc(dateLabel(dl)) : esc(T("not_listed"))) + "</span></div>"
    ].join("");

    var deadlineRows = (p.deadlines || []).map(function (d) {
      var one = nextDeadline([d]);
      return '<div class="deadline-row"><span class="term">' + esc(termLabel(d.term) || "—") + "</span>" +
        '<span class="date">' + esc(dateLabel(d)) + "</span>" +
        '<span class="left">' + esc(one ? daysLabel(one.days) : "") + "</span></div>";
    }).join("");

    var links = linkList(p);

    return '<div class="sheet-head">' +
        '<button class="sheet-close" id="sheet-close" aria-label="Close">✕</button>' +
        '<h2 class="sheet-title">' + esc(p.name) + "</h2>" +
        '<div class="sheet-sub">' + esc(p.university) + (p.city ? " · " + esc(p.city) : "") +
          " · " + countryFlag(p.country) + " " + esc(countryName(p.country)) +
          (p.subject ? " · " + esc(p.subject) : "") + "</div>" +
      "</div>" +
      '<div class="sheet-body">' +
        '<div class="grid">' + tiles + "</div>" +
        (deadlineRows ? '<div class="sec"><h3>' + esc(T("d_deadlines")) + "</h3>" + deadlineRows + "</div>" : "") +
        section(T("d_about"), p.description) +
        section(T("d_reqs"), p.admission_requirements_raw) +
        section(T("d_lang"), p.language_requirement_raw) +
        section(T("d_funding"), p.scholarships_raw) +
        section(T("d_org"), p.course_organisation_raw) +
        section(T("d_intl"), p.international_elements_raw) +
        section(T("d_intern"), p.internships_raw) +
        section(T("d_housing"), p.accommodation_raw) +
        section(T("d_work"), p.part_time_raw) +
        section(T("d_support"), p.support_international) +
        '<div class="sec"><h3>' + esc(T("d_apply")) + "</h3>" +
          (p.application_deadline_raw ? '<div class="txt">' + esc(p.application_deadline_raw) + "</div>" : "") +
          links + "</div>" +
        '<div class="stamp">' + esc(T("checked")) + " " + esc(p.checked_at || "") + "</div>" +
        askHTML() +
      "</div>";
  }

  /* Which field a link came from is what the link is *for*. Labelling them that
   * way tells a user "apply here / money here / requirements here" without us
   * inventing a single word about what is on the other side. */
  var LINK_SOURCES = [
    ["application_url", "l_apply", "l_apply_note"],
    ["scholarships_raw", "l_funding", null],
    ["semester_fee_raw", "l_fee", null],
    ["cost_of_living_raw", "l_living", null],
    ["admission_requirements_raw", "l_reqs", null],
    ["language_requirement_raw", "l_lang", null],
    ["accommodation_raw", "l_housing", null],
    ["part_time_raw", "l_work", null]
  ];
  var URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

  function linkList(p) {
    var seen = {}, rows = [];

    function add(url, labelKey, noteKey) {
      url = String(url).replace(/[.,;)]+$/, "");
      if (!url || seen[url]) return;
      seen[url] = true;
      rows.push(
        '<a class="linkrow" href="' + esc(url) + '" target="_blank" rel="noopener">' +
          '<span class="lr-what">' + esc(T(labelKey)) +
            (noteKey ? '<span class="lr-note">' + esc(T(noteKey)) + "</span>" : "") + "</span>" +
          '<span class="lr-host">' + esc(hostOf(url)) + " ↗</span>" +
        "</a>");
    }

    LINK_SOURCES.forEach(function (src) {
      var value = p[src[0]];
      if (!value) return;
      if (src[0] === "application_url") { add(value, src[1], src[2]); return; }
      (String(value).match(URL_RE) || []).forEach(function (u) { add(u, src[1], src[2]); });
    });
    add(p.source_url, "l_official", "l_official_note");

    return '<div class="linklist">' + rows.join("") + "</div>";
  }

  /** The semester contribution field is a paragraph; the tile needs the figure. */
  function shortFee(text) {
    var m = String(text).match(/([\d][\d.,]*)\s*(?:€|EUR)/i);
    return m ? "€" + m[1] : String(text).slice(0, 28) + "…";
  }

  /* ---------- assistant ---------- */

  function askHTML() {
    return '<div class="ask">' +
      '<div class="thread" id="thread"></div>' +
      '<div class="ask-quote" id="ask-quote"></div>' +
      '<form class="ask-form" id="ask-form">' +
        '<input id="ask-input" type="text" autocomplete="off" placeholder="' + esc(T("ask_ph")) + '">' +
        '<button type="submit">' + esc(T("ask_send")) + "</button>" +
      "</form>" +
      '<div class="ask-hint">' + esc(T("ask_hint")) + "</div>" +
      "</div>";
  }

  var selection = null;

  function wireAsk(p) {
    var form = $("ask-form"), input = $("ask-input"), thread = $("thread");
    selection = null;
    renderQuote();

    form.onsubmit = function (e) {
      e.preventDefault();
      var question = input.value.trim();
      if (!question || asking) return;
      input.value = "";
      asking = true;

      thread.appendChild(el("div", "msg me", question));
      var wait = el("div", "msg ai dots", T("ask_wait"));
      thread.appendChild(wait);
      wait.scrollIntoView({ block: "nearest" });

      fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uid: p.uid, question: question, selection: selection, lang: lang })
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (res) {
          wait.remove();
          if (res.status === 429) { thread.appendChild(el("div", "msg ai err", T("ask_limit"))); return; }
          if (!res.ok || !res.d.answer) { thread.appendChild(el("div", "msg ai err", T("ask_err"))); return; }
          var answer = el("div", "msg ai");
          answer.innerHTML = linkify(res.d.answer);
          thread.appendChild(answer);
          answer.scrollIntoView({ block: "nearest" });
        })
        .catch(function () { wait.remove(); thread.appendChild(el("div", "msg ai err", T("ask_err"))); })
        .finally(function () { asking = false; selection = null; renderQuote(); });
    };
  }

  /** The model answers in light Markdown; render just that subset. Input is
   *  escaped first, so nothing here can inject markup. */
  function linkify(text) {
    var html = esc(text)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

    // Bullet lines ("* item" / "- item") become a real list; other lines stay.
    var out = [], list = null;
    html.split("\n").forEach(function (line) {
      var m = line.match(/^\s*[*-]\s+(.*)$/);
      if (m) {
        list = list || [];
        list.push("<li>" + m[1] + "</li>");
        return;
      }
      if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; }
      if (line.trim()) out.push(line);
    });
    if (list) out.push("<ul>" + list.join("") + "</ul>");
    return out.join("\n");
  }

  function renderQuote() {
    var box = $("ask-quote");
    if (!box) return;
    if (!selection) { box.classList.remove("show"); box.innerHTML = ""; return; }
    box.innerHTML = '<button type="button" aria-label="clear">✕</button>' + esc(selection.slice(0, 240));
    box.classList.add("show");
    box.querySelector("button").onclick = function () { selection = null; renderQuote(); };
  }

  function hidePop() { var p = $("selpop"); if (p) p.classList.remove("show"); }

  document.addEventListener("selectionchange", function () {
    var pop = $("selpop");
    if (!pop || !current) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hidePop(); return; }
    var text = sel.toString().trim();
    var body = document.querySelector(".sheet-body");
    if (text.length < 12 || !body || !body.contains(sel.anchorNode)) { hidePop(); return; }

    var rect = sel.getRangeAt(0).getBoundingClientRect();
    pop.style.left = (rect.left + rect.width / 2) + "px";
    pop.style.top = (rect.top + window.scrollY - 8) + "px";
    pop.textContent = T("sel_ask");
    pop.classList.add("show");
    pop.onclick = function () {
      selection = text;
      renderQuote();
      hidePop();
      var input = $("ask-input");
      if (input) { input.focus(); input.scrollIntoView({ block: "center", behavior: "smooth" }); }
    };
  });

  /* ---------- theme + hero stars (carried over from the original page) ---------- */

  var root = document.documentElement;

  function isDark() { return root.getAttribute("data-theme") === "dark"; }

  function drawStars() {
    var cv = document.querySelector(".hero .stars");
    if (!cv) return;
    var host = cv.parentElement, w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    if (!isDark()) return;
    var n = Math.max(40, Math.round(w * h / 9000));
    for (var i = 0; i < n; i++) {
      var x = (i * 137.5) % w, y = (i * 89.3) % (h * 0.74);
      var r = ((i * 7) % 10) / 10 * 1.1 + 0.3, a = ((i * 13) % 10) / 10 * 0.5 + 0.28;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
      ctx.fillStyle = "rgba(255,255,255," + a + ")"; ctx.fill();
    }
  }

  function paintTheme() {
    var tb = $("themebtn");
    if (tb) tb.textContent = isDark() ? "☀" : "☾";
    drawStars();
  }

  function bindTheme() {
    var tb = $("themebtn");
    var saved = localStorage.getItem("kounsly.theme");
    if (saved) root.setAttribute("data-theme", saved);
    if (tb) tb.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      localStorage.setItem("kounsly.theme", next);
      paintTheme();
    });
    var t;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(drawStars, 150); });
    paintTheme();
  }

  /* ---------- wiring ---------- */

  var debounce;
  function onQuery() {
    clearTimeout(debounce);
    debounce = setTimeout(function () { state.q = $("q").value.trim(); state.page = 1; runSearch(); }, 320);
  }

  function bind() {
    $("q").addEventListener("input", onQuery);
    $("go").addEventListener("click", function () { state.q = $("q").value.trim(); state.page = 1; runSearch(); });
    $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") { state.q = $("q").value.trim(); state.page = 1; runSearch(); } });

    [["f-region", "country"], ["f-country", "area"], ["f-field", "subject"], ["f-level", "level"], ["f-budget", "budget"], ["f-sort", "sort"]]
      .forEach(function (pair) {
        $(pair[0]).addEventListener("change", function () { state[pair[1]] = this.value; state.page = 1; runSearch(); });
      });

    $("f-free").addEventListener("change", function () { state.free = this.checked; state.page = 1; runSearch(); });
    $("reset").addEventListener("click", function () {
      state = { q: "", country: "", area: "", subject: "", level: "", budget: "", free: false, sort: "match", page: 1 };
      $("q").value = ""; $("f-free").checked = false;
      buildSelects(); runSearch();
    });

    document.querySelectorAll(".chip[data-qi]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        $("q").value = T("q" + chip.getAttribute("data-qi"));
        state.q = $("q").value; state.page = 1;
        if (chip.getAttribute("data-qi") === "1") { state.free = true; $("f-free").checked = true; }
        runSearch();
      });
    });

    $("langbtn").addEventListener("click", function () {
      lang = lang === "uk" ? "en" : "uk";
      localStorage.setItem("kounsly.lang", lang);
      applyI18n(); buildSelects();
      if (current) openSheet(current.uid);
      runSearch();
    });

    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  }

  applyI18n();
  bind();
  bindTheme();
  fetch("/api/facets")
    .then(function (r) { return r.json(); })
    .then(function (f) { facets = f; buildSelects(); runSearch(); })
    .catch(function () { runSearch(); });
})();
