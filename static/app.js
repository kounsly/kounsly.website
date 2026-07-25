/* Kounsly — front end over the real catalogue.
 *
 * The page previously shipped a hard-coded array of 28 illustrative programmes.
 * Everything here reads /api instead, so what a visitor sees is what the
 * connectors actually collected, with a source link under every fact.
 */
(function () {
  "use strict";

  var lang = localStorage.getItem("kounsly.lang") || "uk";
  var state = { q: "", country: "", area: "", subject: "", level: "", budget: "", free: false, sort: "match", page: 1, ai: true };
  var facets = null, current = null, asking = false;

  var LEVEL_NEEDS = { bachelor: "school", master: "bachelor", phd: "master" };

  /** What kind of deadline this is: regular, early admission, or for a stated
   *  group of applicants — plus the semester it leads to. Descriptive only; the
   *  site does not yet claim to know which one is the reader's. */
  function deadlineKind(d) {
    var bits = [];
    if (d.applies_to && d.applies_to !== "everyone") bits.push(T("dl_" + d.applies_to));
    else bits.push(T("dl_regular"));
    if (d.term) bits.push(T("term_" + d.term) + " " + T("dl_semester"));
    return bits.join(" · ");
  }

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
      read_as: "Зрозуміла так:", read_off: "шукати дослівно",
      dl_everyone: "для всіх", dl_non_eu: "для не-ЄС", dl_eu_eea: "для громадян ЄС/ЄЕЗ",
      dl_germany: "для заявників з Німеччини/ЄС", dl_early_bird: "ранній вступ", dl_session: "сесія подачі",
      dl_regular: "звичайний вступ", dl_semester: "семестр",
      need_school: "атестат про повну середню освіту", need_bachelor: "ступінь бакалавра", need_master: "ступінь магістра",
      g_steps: "Як подаватися", st_reqs: "Перевір вимоги", st_portal: "Зареєструйся на порталі",
      st_deadline: "Подай заявку до", st_money: "Порахуй витрати",
      st_no_portal: "Портал подачі не вказано — шукай кнопку подачі на офіційній сторінці",
      st_no_deadline: "Дату не вказано — уточни на офіційній сторінці",
      st_portal_note: "це портал, який указав університет — там реєстрація й завантаження документів",
      g_money: "Гроші", g_admission: "Вимоги до вступу", g_deadlines: "Дедлайни й подача",
      g_about: "Про програму", g_life: "Життя та побут", g_extras: "Що ще вказано на сторінці",
      d_deadline_text: "Як указано на сторінці",
      no_data: "Немає даних на офіційній сторінці.", no_data_ask: "уточнити тут ↗",
      free: "Без плати за навчання", per_year: "/ рік", per_semester: "/ семестр", not_listed: "не вказано",
      source: "Джерело:", src_checked: "перевірено",
      lvl_bachelor: "Бакалавр", lvl_master: "Магістр", lvl_phd: "PhD",
      f_tuition: "Плата за навчання", f_deadline: "Найближчий дедлайн", f_english: "Англійська", f_duration: "Тривалість", f_ects: "Обсяг",
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
      read_as: "Read as:", read_off: "search literally",
      dl_everyone: "for everyone", dl_non_eu: "for non-EU", dl_eu_eea: "for EU/EEA citizens",
      dl_germany: "for applicants from Germany/EU", dl_early_bird: "early admission", dl_session: "application session",
      dl_regular: "regular admission", dl_semester: "semester",
      need_school: "school-leaving certificate", need_bachelor: "bachelor's degree", need_master: "master's degree",
      g_steps: "How to apply", st_reqs: "Check the requirements", st_portal: "Register on the portal",
      st_deadline: "Apply by", st_money: "Add up the costs",
      st_no_portal: "No portal stated — look for the apply button on the official page",
      st_no_deadline: "No date stated — check the official page",
      st_portal_note: "the portal the university names — registration and document upload happen there",
      g_money: "Money", g_admission: "Admission requirements", g_deadlines: "Deadlines and applying",
      g_about: "About the programme", g_life: "Life and living", g_extras: "Also stated on the page",
      d_deadline_text: "As stated on the page",
      no_data: "The official page does not state this.", no_data_ask: "check here ↗",
      free: "No tuition fees", per_year: "/ year", per_semester: "/ semester", not_listed: "not listed",
      source: "Source:", src_checked: "checked",
      lvl_bachelor: "Bachelor", lvl_master: "Master", lvl_phd: "PhD",
      f_tuition: "Tuition", f_deadline: "Next deadline", f_english: "English", f_duration: "Duration", f_ects: "Credits",
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

  /* Filled in ahead of the connectors. A country arriving in the data without
   * an entry here renders as a bare code — "SE" with no flag and no Ukrainian
   * name — so the map covers Europe now rather than needing a front-end change
   * every time a source comes online. */
  var COUNTRY = {
    DE: { uk: "Німеччина", en: "Germany", flag: "🇩🇪" },
    FI: { uk: "Фінляндія", en: "Finland", flag: "🇫🇮" },
    SE: { uk: "Швеція", en: "Sweden", flag: "🇸🇪" },
    NO: { uk: "Норвегія", en: "Norway", flag: "🇳🇴" },
    DK: { uk: "Данія", en: "Denmark", flag: "🇩🇰" },
    IS: { uk: "Ісландія", en: "Iceland", flag: "🇮🇸" },
    NL: { uk: "Нідерланди", en: "Netherlands", flag: "🇳🇱" },
    BE: { uk: "Бельгія", en: "Belgium", flag: "🇧🇪" },
    LU: { uk: "Люксембург", en: "Luxembourg", flag: "🇱🇺" },
    IE: { uk: "Ірландія", en: "Ireland", flag: "🇮🇪" },
    FR: { uk: "Франція", en: "France", flag: "🇫🇷" },
    ES: { uk: "Іспанія", en: "Spain", flag: "🇪🇸" },
    PT: { uk: "Португалія", en: "Portugal", flag: "🇵🇹" },
    IT: { uk: "Італія", en: "Italy", flag: "🇮🇹" },
    AT: { uk: "Австрія", en: "Austria", flag: "🇦🇹" },
    CH: { uk: "Швейцарія", en: "Switzerland", flag: "🇨🇭" },
    PL: { uk: "Польща", en: "Poland", flag: "🇵🇱" },
    CZ: { uk: "Чехія", en: "Czechia", flag: "🇨🇿" },
    SK: { uk: "Словаччина", en: "Slovakia", flag: "🇸🇰" },
    HU: { uk: "Угорщина", en: "Hungary", flag: "🇭🇺" },
    SI: { uk: "Словенія", en: "Slovenia", flag: "🇸🇮" },
    HR: { uk: "Хорватія", en: "Croatia", flag: "🇭🇷" },
    RO: { uk: "Румунія", en: "Romania", flag: "🇷🇴" },
    BG: { uk: "Болгарія", en: "Bulgaria", flag: "🇧🇬" },
    GR: { uk: "Греція", en: "Greece", flag: "🇬🇷" },
    CY: { uk: "Кіпр", en: "Cyprus", flag: "🇨🇾" },
    MT: { uk: "Мальта", en: "Malta", flag: "🇲🇹" },
    EE: { uk: "Естонія", en: "Estonia", flag: "🇪🇪" },
    LV: { uk: "Латвія", en: "Latvia", flag: "🇱🇻" },
    LT: { uk: "Литва", en: "Lithuania", flag: "🇱🇹" },
    GB: { uk: "Велика Британія", en: "United Kingdom", flag: "🇬🇧" },
    RS: { uk: "Сербія", en: "Serbia", flag: "🇷🇸" },
    TR: { uk: "Туреччина", en: "Türkiye", flag: "🇹🇷" }
  };
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
      // Carry applies_to: the step block names the group, and losing it here made
      // a non-EU date read as "for everyone".
      if (!best || days < best.days) {
        best = { days: days, month: d.month, day: d.day, term: d.term, applies_to: d.applies_to };
      }
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
    if (state.ai === false) p.set("ai", "false");
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
    var read = interpretation(data);
    if (read) list.appendChild(read);
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
        "</div><span class=\"lvl\">" + esc(shortDegree(item)) + "</span></div>" +
      '<div class="facts">' +
        '<div class="fact"><span class="k">' + esc(T("f_tuition")) + "</span>" +
          '<span class="v big' + (free || cheap ? " free" : "") + '">' + esc(money(item, true)) + "</span>" +
          (tuitionNote ? '<span class="note">' + esc(tuitionNote) + "</span>" : "") + "</div>" +
        '<div class="fact"><span class="k">' + esc(T("f_deadline")) + "</span>" +
          '<span class="v' + (soon ? " soon" : "") + '">' + esc(dl ? dateLabel(dl) : T("not_listed")) + "</span>" +
          (dl ? '<span class="note">' + esc(soon ? daysLabel(dl.days) : (termLabel(dl.term) || "")) + "</span>" : "") + "</div>" +
        '<div class="fact"><span class="k">' + esc(T("f_english")) + "</span>" +
          '<span class="v">' + esc(englishLabel(item)) + "</span></div>" +
        '<div class="fact"><span class="k">' + esc(item.duration_raw ? T("f_duration") : T("f_ects")) + "</span>" +
          '<span class="v">' + esc(item.duration_raw || item.ects || T("not_listed")) + "</span></div>" +
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

  /** The badge is sized for "MSc". Some sources put a sentence in that field
   *  ("Master of Science (MSc, with an option to…)"), which pushed the page
   *  1,961px wide on a phone. Long titles fall back to the level; the full
   *  wording is still in the detail view. */
  function shortDegree(item) {
    var title = (item.degree_title || "").trim();
    if (title && title.length <= 24) return title;
    var abbrev = title.match(/\b(M\.?Sc\.?|B\.?Sc\.?|M\.?A\.?|B\.?A\.?|M\.?Eng\.?|B\.?Eng\.?|LL\.?M\.?|MBA|Ph\.?D\.?|M\.?Ed\.?|B\.?Ed\.?)\b/i);
    return abbrev ? abbrev[0] : T("lvl_" + item.degree_level);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\d?\./, ""); } catch (e) { return ""; }
  }

  /** Show what the model made of the phrase, and let the user throw it away.
   *  An inferred filter that silently hides results is worse than no filter. */
  function interpretation(data) {
    var i = data.interpreted || {};
    var chips = [];
    if (i.subject) chips.push(i.subject);
    if (i.level) chips.push(T("lvl_" + i.level));
    if (i.country) chips.push(countryFlag(i.country) + " " + countryName(i.country));
    if (i.free_only) chips.push(T("free"));
    if (i.max_tuition_eur_year) chips.push("≤ €" + Math.round(i.max_tuition_eur_year));
    if (i.max_ielts) chips.push("IELTS ≤ " + i.max_ielts);
    if (!chips.length) return null;

    var box = el("div", "read");
    box.innerHTML = '<span class="read-k">' + esc(T("read_as")) + "</span>" +
      chips.map(function (c) { return '<span class="read-chip">' + esc(c) + "</span>"; }).join("") +
      '<button class="read-off" type="button">' + esc(T("read_off")) + "</button>";
    box.querySelector(".read-off").onclick = function () {
      state.ai = false;
      state.page = 1;
      runSearch();
    };
    return box;
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

  /* Ukrainian versions of the prose fields are pre-translated into the database.
   * Fall back to the source language only when a translation is missing, so the
   * page is never half in a language the reader did not choose. */
  var UK_FIELD = {
    description: "description_uk",
    admission_requirements_raw: "admission_requirements_uk",
    language_requirement_raw: "language_requirement_uk",
    scholarships_raw: "scholarships_uk",
    semester_fee_raw: "semester_fee_uk",
    cost_of_living_raw: "cost_of_living_uk",
    course_organisation_raw: "course_organisation_uk",
    international_elements_raw: "international_elements_uk",
    internships_raw: "internships_uk",
    accommodation_raw: "accommodation_uk",
    part_time_raw: "part_time_raw_uk",
    support_international: "support_international_uk",
    application_deadline_raw: "application_deadline_uk"
  };

  function txt(p, field) {
    if (lang === "uk" && UK_FIELD[field] && p[UK_FIELD[field]]) return p[UK_FIELD[field]];
    return p[field];
  }

  /** Source prose carries bare URLs and e-mail addresses ("purchased for 95 EUR:
   *  https://…", "E-mail: international@uni-landau.de"). Escaped first, so this
   *  can only ever turn text into a link, never inject markup. */
  function linkifyText(s) {
    return esc(s)
      .replace(/(https?:\/\/[^\s<>"']+?)([.,;:)\]]*)(?=\s|$)/g,
               '<a href="$1" target="_blank" rel="noopener">$1</a>$2')
      .replace(/\bwww\.[^\s<>"']+?([.,;:)\]]*)(?=\s|$)/g, function (m, tail) {
        var url = m.slice(0, m.length - tail.length);
        return '<a href="https://' + url + '" target="_blank" rel="noopener">' + url + "</a>" + tail;
      })
      .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
               '<a href="mailto:$1">$1</a>');
  }

  function section(title, text) {
    if (!text) return "";
    return '<div class="sec"><h3>' + esc(title) + '</h3><div class="txt">' + linkifyText(text) + "</div></div>";
  }

  /* One template for every programme. A field the source does not state is shown
   * as missing with somewhere to go, rather than quietly omitted — "we don't
   * know" and "it doesn't apply" are different answers to a person deciding
   * where to spend two years. Optional fields are omitted when empty. */
  function block(p, labelKey, field, opts) {
    opts = opts || {};
    var value = opts.value !== undefined ? opts.value : txt(p, field);
    if (value) {
      // `wide` drops the label column: for a long prose block the group heading
      // already says what it is, and repeating it wastes a third of the width.
      if (opts.wide) return '<div class="row wide"><div class="row-v">' + linkifyText(value) + "</div></div>";
      return '<div class="row' + (opts.figure ? " money-row" : "") + '"><div class="row-k">' + esc(T(labelKey)) + "</div>" +
        '<div class="row-v">' + linkifyText(value) + "</div></div>";
    }
    if (!opts.required) return "";
    var where = p.application_url || p.source_url;
    return '<div class="row missing"><div class="row-k">' + esc(T(labelKey)) + "</div>" +
      '<div class="row-v">' + esc(T("no_data")) +
        (where ? ' <a href="' + esc(where) + '" target="_blank" rel="noopener">' + esc(T("no_data_ask")) + "</a>" : "") +
      "</div></div>";
  }

  function group(titleKey, rows) {
    var body = rows.filter(Boolean).join("");
    return body ? '<div class="grp"><h3>' + esc(T(titleKey)) + "</h3>" + body + "</div>" : "";
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

    function tile(labelKey, value, extra) {
      var words = !/\d/.test(String(value));
      return '<div class="tile' + (extra || "") + '"><b>' + esc(T(labelKey)) + "</b>" +
        '<span class="' + (words ? "words" : "") + '">' + esc(value) + "</span></div>";
    }

    var tiles = [
      tile("f_tuition", money(p, true), free ? " free" : ""),
      tile("d_semester", p.semester_fee_raw ? shortFee(txt(p, "semester_fee_raw")) : T("not_listed")),
      tile("d_living", p.cost_of_living_eur_month ? "≈ €" + p.cost_of_living_eur_month : T("not_listed")),
      tile("f_english", englishLabel(p)),
      tile(p.duration_raw ? "f_duration" : "f_ects", p.duration_raw || p.ects || T("not_listed")),
      tile("f_deadline", dl ? dateLabel(dl) : T("not_listed"))
    ].join("");

    // Every date says what kind of deadline it is — regular, early admission, or
    // for a particular group of applicants. Three unexplained dates read as a
    // bug; the source distinguished them all along. Which one is *yours* waits
    // for accounts.
    var deadlineRows = (p.deadlines || []).map(function (d) {
      var one = nextDeadline([d]);
      return '<div class="deadline-row">' +
        '<span class="date">' + esc(dateLabel(d)) + "</span>" +
        '<span class="who">' + esc(deadlineKind(d)) + "</span>" +
        '<span class="left">' + esc(one ? daysLabel(one.days) : "") + "</span></div>";
    }).join("");

    var links = linkList(p);

    var extras = (p.extras && typeof p.extras === "object")
      ? Object.keys(p.extras).map(function (k) {
          return '<div class="row"><div class="row-k">' + esc(k) + "</div>" +
                 '<div class="row-v">' + esc(p.extras[k]) + "</div></div>";
        }).join("")
      : "";

    return '<div class="sheet-head">' +
        '<button class="sheet-close" id="sheet-close" aria-label="Close">✕</button>' +
        '<h2 class="sheet-title">' + esc(p.name) + "</h2>" +
        '<div class="sheet-sub">' + esc(p.university) + (p.city ? " · " + esc(p.city) : "") +
          " · " + countryFlag(p.country) + " " + esc(countryName(p.country)) +
          (p.subject ? " · " + esc(p.subject) : "") + "</div>" +
      "</div>" +
      '<div class="sheet-body">' +
        '<div class="grid">' + tiles + "</div>" +

        group("g_money", [
          // Pass null rather than the "not listed" string, so an unknown fee gets
          // the missing state with a link instead of a dead end.
          block(p, "f_tuition", null, {
            value: (p.tuition_free === 1 || p.tuition_eur_year != null) ? money(p) : null,
            required: true, figure: true
          }),
          block(p, "d_semester", "semester_fee_raw", { required: true }),
          block(p, "d_living", "cost_of_living_raw", { required: true }),
          block(p, "d_funding", "scholarships_raw", { required: true })
        ]) +

        group("g_admission", [
          block(p, "d_reqs", "admission_requirements_raw", { required: true }),
          block(p, "d_lang", "language_requirement_raw", { required: true })
        ]) +

        stepsHTML(p) +

        group("g_deadlines", [
          deadlineRows
            ? '<div class="row"><div class="row-k">' + esc(T("d_deadlines")) + '</div><div class="row-v">' + deadlineRows + "</div></div>"
            : "",
          block(p, "d_deadline_text", "application_deadline_raw", { required: !deadlineRows })
        ]) +

        group("g_about", [
          block(p, "d_about", "description", { required: true, wide: true }),
          block(p, "d_org", "course_organisation_raw"),
          block(p, "d_intl", "international_elements_raw"),
          block(p, "d_intern", "internships_raw")
        ]) +

        group("g_life", [
          block(p, "d_housing", "accommodation_raw"),
          block(p, "d_work", "part_time_raw"),
          block(p, "d_support", "support_international")
        ]) +

        (extras ? '<div class="grp"><h3>' + esc(T("g_extras")) + "</h3>" + extras + "</div>" : "") +

        '<div class="grp"><h3>' + esc(T("d_apply")) + "</h3>" + links + "</div>" +
        '<div class="stamp">' + esc(T("checked")) + " " + esc(p.checked_at || "") + "</div>" +
        askHTML() +
      "</div>";
  }

  /* Concrete steps, assembled from the fields we hold — no model involved, so
   * nothing here can be invented. A step whose fact is missing says so and links
   * out instead of guessing. */
  function stepsHTML(p) {
    var steps = [];

    var reqs = [];
    if (p.degree_level && LEVEL_NEEDS[p.degree_level]) reqs.push(T("need_" + LEVEL_NEEDS[p.degree_level]));
    if (p.ielts) reqs.push("IELTS " + p.ielts);
    if (p.toefl_ibt) reqs.push("TOEFL " + p.toefl_ibt);
    if (!reqs.length && p.english_cefr) reqs.push(T("f_english") + " " + p.english_cefr);
    if (reqs.length) steps.push({ k: T("st_reqs"), v: reqs.join(" · ") });

    if (p.application_url) {
      steps.push({
        k: T("st_portal"),
        v: '<a href="' + esc(p.application_url) + '" target="_blank" rel="noopener">' + esc(hostOf(p.application_url)) + " ↗</a>",
        note: T("st_portal_note"), raw: true
      });
    } else {
      steps.push({ k: T("st_portal"), v: T("st_no_portal"), missing: true });
    }

    var dates = (p.deadlines || []).slice().sort(function (a, b) {
      return (a.month * 100 + a.day) - (b.month * 100 + b.day);
    });
    if (dates.length) {
      steps.push({
        k: T("st_deadline"),
        v: dates.map(function (d) {
          return "<b>" + esc(dateLabel(d)) + "</b> — " + esc(deadlineKind(d));
        }).join("<br>"),
        raw: true
      });
    } else {
      steps.push({ k: T("st_deadline"), v: T("st_no_deadline"), missing: true });
    }

    var money = [];
    money.push(T("f_tuition") + ": " + (p.tuition_free === 1 || p.tuition_eur_year === 0
      ? "€0" : (p.tuition_eur_year != null ? "€" + Math.round(p.tuition_eur_year) + " " + T("per_year") : T("not_listed"))));
    if (p.semester_fee_raw) money.push(T("d_semester") + ": " + shortFee(txt(p, "semester_fee_raw")));
    if (p.cost_of_living_eur_month) money.push(T("d_living") + ": ≈ €" + p.cost_of_living_eur_month);
    steps.push({ k: T("st_money"), v: money.join(" · ") });

    var rows = steps.map(function (s, i) {
      var value = s.raw ? s.v : esc(s.v);
      return '<div class="step' + (s.missing ? " missing" : "") + '">' +
        '<span class="step-n">' + (i + 1) + "</span>" +
        '<div class="step-b"><div class="step-k">' + esc(s.k) + "</div>" +
          '<div class="step-v">' + value + "</div>" +
          (s.note ? '<div class="step-note">' + esc(s.note) + "</div>" : "") +
        "</div></div>";
    }).join("");

    return '<div class="grp"><h3>' + esc(T("g_steps")) + "</h3>" + rows + "</div>";
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
    var seen = {}, perPurpose = {}, rows = [];

    function add(url, labelKey, noteKey) {
      url = String(url).replace(/[.,;)]+$/, "");
      if (!url) return;
      // Three links all labelled "housing" is noise, not thoroughness: one entry
      // per purpose+host, and at most two per purpose.
      var hostKey = labelKey + "@" + hostOf(url);
      if (seen[url] || seen[hostKey]) return;
      perPurpose[labelKey] = (perPurpose[labelKey] || 0) + 1;
      if (perPurpose[labelKey] > 2) return;
      seen[url] = seen[hostKey] = true;
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
    debounce = setTimeout(function () { state.q = $("q").value.trim(); state.page = 1; state.ai = true; runSearch(); }, 320);
  }

  function bind() {
    $("q").addEventListener("input", onQuery);
    $("go").addEventListener("click", function () { state.q = $("q").value.trim(); state.page = 1; state.ai = true; runSearch(); });
    $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") { state.q = $("q").value.trim(); state.page = 1; state.ai = true; runSearch(); } });

    [["f-region", "country"], ["f-country", "area"], ["f-field", "subject"], ["f-level", "level"], ["f-budget", "budget"], ["f-sort", "sort"]]
      .forEach(function (pair) {
        $(pair[0]).addEventListener("change", function () { state[pair[1]] = this.value; state.page = 1; runSearch(); });
      });

    $("f-free").addEventListener("change", function () { state.free = this.checked; state.page = 1; runSearch(); });
    $("reset").addEventListener("click", function () {
      state = { q: "", country: "", area: "", subject: "", level: "", budget: "", free: false, sort: "match", page: 1, ai: true };
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
