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
  var EDU_RANK = { school: 1, bachelor: 2, master: 3 };

  /* auth.js runs first (both scripts are deferred, so they run in order), so
   * this is always there. It answers "is anyone signed in" for the rest of the
   * file; when accounts are switched off it simply reports nobody. */
  var A = window.KounslyAuth;

  function profile() {
    var u = A && A.user();
    return (u && u.profile) || null;
  }

  /* Which stated deadline belongs to this reader. Only these three values name
   * a group of applicants — an early-admission or session date applies to
   * whoever it applies to and is not about citizenship. */
  var GROUPED = { non_eu: 1, eu_eea: 1, germany: 1 };

  function myGroup() {
    var p = profile();
    if (!p || !p.citizenship) return null;
    return p.citizenship === "EU" ? "eu_eea" : "non_eu";
  }

  function isMyDeadline(d) {
    var mine = myGroup();
    if (!mine) return false;                       // we don't know, so we don't claim
    if (!d.applies_to || !GROUPED[d.applies_to]) return true;
    if (d.applies_to === mine) return true;
    return mine === "eu_eea" && d.applies_to === "germany";
  }

  /* Once we know the reader's group, the headline date has to be theirs too.
   * The tile takes the calendar-nearest date, which for a Ukrainian applicant
   * was an EU-only deadline — while the list below correctly marked a different
   * date as theirs. One programme cannot state two different "next deadlines"
   * to the same person. Falls back to the full set when nothing matches, so a
   * date is never hidden entirely. */
  function ownDeadlines(list) {
    if (!list || !list.length || !myGroup()) return list;
    var mine = list.filter(isMyDeadline);
    return mine.length ? mine : list;
  }

  /* Arithmetic on stated facts, never a prediction: what the page asks for
   * against what the profile says. Silent whenever either side is unknown —
   * "we don't know your score" must never render as "you don't qualify". */
  function eligibility(p) {
    var me = profile();
    if (!me) return [];
    var notes = [];

    if (me.education && LEVEL_NEEDS[p.degree_level]) {
      var need = LEVEL_NEEDS[p.degree_level];
      if ((EDU_RANK[me.education] || 0) < EDU_RANK[need]) {
        notes.push({ ok: false, text: T("el_need").replace("{what}", T("need_" + need)) });
      }
    }
    [["ielts", "el_ielts", p.ielts, 1], ["toefl", "el_toefl", p.toefl_ibt, 0]].forEach(function (t) {
      var have = parseFloat(me[t[0]]), required = t[2];
      if (isNaN(have) || required == null) return;
      var gap = Math.round((required - have) * 10) / 10;
      if (gap > 0) {
        notes.push({ ok: false, text: T(t[1]).replace("{req}", required)
          .replace("{have}", have.toFixed(t[3])).replace("{gap}", gap.toFixed(t[3])) });
      }
    });

    return notes;
  }

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
      f_terms: "Умови користування", f_privacy: "Політика приватності",
      f_help: "Потрібна допомога? Напиши нам", f_rights: "Усі права застережено.",
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
      forget: "Прибрати з історії", forget_all: "Очистити все",
      recent_t: "Твої пошуки", recent_more: "ще {n} у списку",
      recent_all: "Показати всі", recent_less: "Згорнути",
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
      ask_wait: "Читаю дані програми", ask_err: "Асистент недоступний. Спробуй ще раз.",
      ask_limit: "Ліміт безкоштовних питань на годину вичерпано.",
      ask_month: "Питання на цей місяць вичерпано. Лічильник оновиться 1 числа.",
      see_below: "див. нижче", per_month: "на місяць",
      ask_wall: "Це були твої безкоштовні питання. Зареєструйся — і питай про будь-яку програму далі.",
      ask_wall_btn: "Зареєструватися",
      ask_locked_ph: "Зареєструйся, щоб питати далі",
      lock_filters: "Решта фільтрів — після реєстрації. Пошук за спеціальністю працює й так.",
      lock_btn: "Зареєструватися",
      save: "Зберегти", saved: "Збережено", save_aria: "Зберегти програму",
      watch: "Нагадати про дедлайн", watching: "Нагадаємо про дедлайн",
      saved_t: "Збережені програми", saved_empty: "Тут поки порожньо — тисни ★ на будь-якій програмі.",
      back_search: "← До пошуку",
      my_deadline: "твій дедлайн", el_ok: "вимоги за твоїм профілем виконано",
      el_need: "потрібен {what}", el_ielts: "IELTS {req} — у тебе {have}, бракує {gap}",
      el_toefl: "TOEFL {req} — у тебе {have}, бракує {gap}",
      el_title: "Що каже твій профіль",
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
      f_terms: "Terms of use", f_privacy: "Privacy policy",
      f_help: "Need help? Write to us", f_rights: "All rights reserved.",
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
      forget: "Remove from history", forget_all: "Clear all",
      recent_t: "Your searches", recent_more: "{n} more",
      recent_all: "Show all", recent_less: "Show fewer",
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
      ask_month: "You've used this month's questions. The counter resets on the 1st.",
      see_below: "stated below", per_month: "a month",
      ask_wall: "That was your last free question. Create an account and keep asking, about any programme.",
      ask_wall_btn: "Create an account",
      ask_locked_ph: "Sign in to keep asking",
      lock_filters: "The rest of the filters come with an account. Searching by subject works either way.",
      lock_btn: "Create an account",
      save: "Save", saved: "Saved", save_aria: "Save this programme",
      watch: "Remind me about the deadline", watching: "Reminder on",
      saved_t: "Saved programmes", saved_empty: "Nothing here yet — hit ★ on any programme.",
      back_search: "← Back to search",
      my_deadline: "your deadline", el_ok: "your profile meets the stated requirements",
      el_need: "{what} required", el_ielts: "IELTS {req} — you have {have}, {gap} short",
      el_toefl: "TOEFL {req} — you have {have}, {gap} short",
      el_title: "What your profile says",
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
    TR: { uk: "Туреччина", en: "Türkiye", flag: "🇹🇷" },
    US: { uk: "США", en: "United States", flag: "🇺🇸" },
    CA: { uk: "Канада", en: "Canada", flag: "🇨🇦" },
    JP: { uk: "Японія", en: "Japan", flag: "🇯🇵" },
    KR: { uk: "Південна Корея", en: "South Korea", flag: "🇰🇷" },
    CN: { uk: "Китай", en: "China", flag: "🇨🇳" },
    TW: { uk: "Тайвань", en: "Taiwan", flag: "🇹🇼" },
    SG: { uk: "Сінгапур", en: "Singapore", flag: "🇸🇬" },
    HK: { uk: "Гонконг", en: "Hong Kong", flag: "🇭🇰" },
    MY: { uk: "Малайзія", en: "Malaysia", flag: "🇲🇾" },
    AE: { uk: "ОАЕ", en: "United Arab Emirates", flag: "🇦🇪" },
    QA: { uk: "Катар", en: "Qatar", flag: "🇶🇦" },
    SA: { uk: "Саудівська Аравія", en: "Saudi Arabia", flag: "🇸🇦" },
    AU: { uk: "Австралія", en: "Australia", flag: "🇦🇺" },
    NZ: { uk: "Нова Зеландія", en: "New Zealand", flag: "🇳🇿" }
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

  /* ---------- filters a stranger doesn't get yet ----------
   *
   * Subject stays open, because it is the question everyone arrives with and
   * answering it is what makes an account worth making. The rest are drawn,
   * disabled, and open the wall when pressed — visible on purpose: a greyed
   * "Країна" says what signing in buys, while a hidden one says nothing.
   *
   * Server-side this is not enforced, and does not need to be: /api/search
   * takes the same parameters it always did. Someone who edits a URL is not the
   * person this is for.
   */
  function filtersLocked() { return !!(A && A.enabled && !A.signedIn()); }

  function applyFilterLocks() {
    var locked = filtersLocked();
    document.querySelectorAll(".filters [data-gated]").forEach(function (g) {
      g.classList.toggle("locked", locked);
      g.querySelectorAll("select, input").forEach(function (c) { c.disabled = locked; });
    });

    var box = $("flock");
    if (!box) return;
    box.hidden = !locked;
    if (!locked) { box.innerHTML = ""; return; }
    box.innerHTML = '<p class="flock-t"></p><button type="button" class="flock-btn"></button>';
    box.querySelector(".flock-t").textContent = T("lock_filters");
    var btn = box.querySelector(".flock-btn");
    btn.textContent = T("lock_btn");
    btn.onclick = function () { A.openGate("signup", null); };
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
  var historyTimer = null;

  /* The box searches as you type, so most of what runs through here is a
   * prefix of what someone meant — "маг", "магіст", "магістр". Recording each
   * one would fill the history with things nobody searched for. Waiting until
   * a query has stood unchanged for a couple of seconds records the phrase
   * they stopped at, and only that one. */
  var REMEMBER_AFTER = 2500;

  function runSearch() {
    var list = $("list"), token = ++searchToken;
    clearTimeout(historyTimer);
    list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    fetch("/api/search?" + params())
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (token !== searchToken) return;   // a newer query already answered
        render(data);
        if (A && state.q && data.total) {
          var q = state.q, saved = searchState();
          historyTimer = setTimeout(function () { A.rememberSearch(q, saved); }, REMEMBER_AFTER);
        }
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

  /* The saved list is the same list, from a different source: the cards, the
   * modal and the assistant all behave identically, so nothing here is a second
   * implementation of the results view. */
  function showSaved() {
    var list = $("list"), uids = A.savedUids();
    window.scrollTo({ top: 0, behavior: "smooth" });

    function frame(inner) {
      list.innerHTML = "";
      var bar = el("div", "savedbar");
      bar.appendChild(el("h2", null, T("saved_t")));
      var back = el("button", null, T("back_search"));
      back.onclick = function () { state.page = 1; runSearch(); };
      bar.appendChild(back);
      list.appendChild(bar);
      inner.forEach(function (n) { list.appendChild(n); });
    }

    $("count").textContent = uids.length + " " + T("programmes");
    if (!uids.length) {
      var box = el("div", "empty");
      box.appendChild(el("p", null, T("saved_empty")));
      frame([box]);
      return;
    }

    list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    fetch("/api/programs?uids=" + encodeURIComponent(uids.join(",")))
      .then(function (r) { return r.json(); })
      .then(function (d) { frame((d.items || []).map(card)); })
      .catch(function () { frame([el("div", "empty", T("ask_err"))]); });
  }

  /** Uses the page's original card classes (.top/.uni/.lvl/.facts/.fact/.k/.v/
   *  .big/.free/.soon/.note/.foot/.src/.lnk) so the typography that made these
   *  cards look good is the same — only the data behind it is real now. */
  function card(item) {
    var node = el("article", "card");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    var dl = nextDeadline(ownDeadlines(item.deadlines));
    var free = item.tuition_free === 1 || item.tuition_eur_year === 0;
    var cheap = item.tuition_eur_year != null && item.tuition_eur_year > 0 && item.tuition_eur_year <= 3000;
    var soon = dl && dl.days <= 30;

    var tuitionNote = free
      ? (item.semester_fee_raw ? "+ " + shortFee(item.semester_fee_raw) + " " + T("per_semester") : "")
      : (item.tuition_raw && !/^\s*\d/.test(item.tuition_raw) ? item.tuition_raw.slice(0, 40) : "");

    node.innerHTML =
      saveStar(item.uid) +
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

  /* ---------- saving ----------
   *
   * The star is on the card for signed-out visitors too, and it fills in when
   * they press it. Starring is the moment worth an account, so it has to be
   * offered before there is one — the programme is held locally and the sign-in
   * box opens behind an already-filled star. Refusing the click and showing a
   * login form instead turns an offer into a toll gate.
   */

  /* Drawn, not typed. The ♥ glyph renders differently in every font, comes out
     thin at this size, and its outline twin ♡ is thinner still — at 14px the
     control that keeps a programme was barely visible. One path, filled when
     the programme is kept. */
  function heart(on) {
    return '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false">' +
      '<path d="M12 20.4 4.2 12.6a4.9 4.9 0 0 1 0-7 5 5 0 0 1 7 0l.8.8.8-.8a5 5 0 0 1 7 0 4.9 4.9 0 0 1 0 7z" ' +
      'fill="' + (on ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      "</svg>";
  }

  function saveStar(uid) {
    if (!A || !A.enabled) return "";
    var on = A.isSaved(uid);
    return '<button class="save' + (on ? " on" : "") + '" data-uid="' + esc(uid) + '"' +
      ' aria-label="' + esc(T("save_aria")) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
      heart(on) + "</button>";
  }

  function actsHTML(p) {
    if (!A || !A.enabled) return "";
    var saved = A.isSaved(p.uid), watched = A.isWatched(p.uid);
    return '<div class="sheet-acts">' +
      '<button class="sheet-act' + (saved ? " on" : "") + '" data-act="save" data-uid="' + esc(p.uid) + '">' +
        "<span>" + heart(saved) + "</span>" + esc(T(saved ? "saved" : "save")) + "</button>" +
      // Only once there is a sender behind it. Offering to e-mail someone before
      // a deadline, and then not doing it, costs more than never offering.
      (A.reminders()
        ? '<button class="sheet-act' + (watched ? " on" : "") + '" data-act="watch" data-uid="' + esc(p.uid) + '">' +
            "<span>◷</span>" + esc(T(watched ? "watching" : "watch")) + "</button>"
        : "") +
    "</div>";
  }

  /* Clicks are handled once, at the document, in the capture phase. Capture
   * because the whole card is a click target that opens the detail sheet, and a
   * bubble-phase handler on the star would run after it — pressing save would
   * also open the programme. */
  document.addEventListener("click", function (e) {
    if (!A || !A.enabled || !e.target.closest) return;

    var star = e.target.closest(".save[data-uid]");
    if (star) {
      e.preventDefault();
      e.stopPropagation();
      A.toggleSaved(star.getAttribute("data-uid"));
      return;
    }
    var act = e.target.closest(".sheet-act[data-act]");
    if (act) {
      e.preventDefault();
      var uid = act.getAttribute("data-uid");
      if (act.getAttribute("data-act") === "save") A.toggleSaved(uid);
      else A.toggleWatched(uid);
    }
  }, true);

  /** Repaint only what depends on the account. Deliberately not a re-search:
   *  starring a programme must not reshuffle the list under the reader's hand. */
  function syncAuthUI() {
    if (!A) return;
    document.querySelectorAll(".save[data-uid]").forEach(function (b) {
      var on = A.isSaved(b.getAttribute("data-uid"));
      b.classList.toggle("on", on);
      b.innerHTML = heart(on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var acts = document.querySelector(".sheet-acts");
    if (acts && current) acts.outerHTML = actsHTML(current);
    var left = document.getElementById("ask-left");
    if (left) paintQuota(left);
    paintRecent();
    // Signing in is what unlocks the filter panel, and this runs on every
    // change to who is looking — including the one that happens without a page
    // load, when the wall is answered in place.
    applyFilterLocks();
  }

  /* ---------- search history ----------
   *
   * The filters are kept beside the phrase as JSON rather than as the query
   * string the API takes: this round-trips the state exactly, and it means a
   * change to how a filter is sent to the server does not silently reinterpret
   * a search someone saved last month.
   */

  function searchState() {
    return JSON.stringify({
      country: state.country, area: state.area, subject: state.subject,
      level: state.level, budget: state.budget, free: state.free, sort: state.sort
    });
  }

  function restoreSearch(q, params) {
    var saved = {};
    try { saved = JSON.parse(params || "{}") || {}; } catch (e) { saved = {}; }
    state.q = q;
    ["country", "area", "subject", "level", "budget", "sort"].forEach(function (k) {
      if (typeof saved[k] === "string") state[k] = saved[k];
    });
    state.free = !!saved.free;
    state.page = 1;
    $("q").value = q;
    $("f-free").checked = state.free;
    buildSelects();
    runSearch();
  }

  /* Past searches, under the box they were typed into.
   *
   * They used to be eight chips sitting permanently below the field, which
   * meant the row was either in the way or ignored, and there was nowhere to
   * see the rest of them. As a panel they behave the way every search box
   * behaves: closed until the field is focused, one row per search, a ✕ per
   * row, and a way to clear the lot.
   *
   * The examples stay visible now instead of being replaced by the history —
   * they teach the phrasing, and the phrasing is what makes this search work.
   */
  var HISTORY_SHOWN = 6;
  var suggOpen = false, suggAll = false;

  function paintRecent() {
    var box = $("sugg");
    if (!box) return;
    var recent = A ? A.history() : [];
    if (!recent.length || !suggOpen) { box.hidden = true; box.innerHTML = ""; return; }

    var shown = suggAll ? recent : recent.slice(0, HISTORY_SHOWN);
    box.innerHTML = "";
    box.hidden = false;

    var head = el("div", "head");
    head.appendChild(el("b", null, T("recent_t")));
    var clear = el("button", "ac-quiet", T("forget_all"));
    clear.type = "button";
    clear.onclick = function (e) { e.stopPropagation(); suggAll = false; A.forgetSearch(""); };
    head.appendChild(clear);
    box.appendChild(head);

    shown.forEach(function (item) {
      var row = el("button", "sugg-row");
      row.type = "button";
      row.appendChild(el("span", "ic", "↺"));
      row.appendChild(el("span", "q", item.q));
      if (item.at) row.appendChild(el("span", "when", whenLabel(item.at)));
      var x = el("button", "x", "✕");
      x.type = "button";
      x.title = T("forget");
      x.setAttribute("aria-label", T("forget"));
      x.onclick = function (e) { e.stopPropagation(); A.forgetSearch(item.q); };
      row.appendChild(x);
      row.onclick = function () { closeSugg(); restoreSearch(item.q, item.params); };
      box.appendChild(row);
    });

    if (recent.length > HISTORY_SHOWN) {
      var foot = el("div", "foot");
      // Only while there is something still hidden: "0 more" under an expanded
      // list is a count of nothing.
      foot.appendChild(el("span", null, suggAll ? "" : T("recent_more").replace("{n}", recent.length - shown.length)));
      var all = el("button", "ac-quiet", T(suggAll ? "recent_less" : "recent_all"));
      all.type = "button";
      all.onclick = function (e) { e.stopPropagation(); suggAll = !suggAll; paintRecent(); };
      foot.appendChild(all);
      box.appendChild(foot);
    }
  }

  /** Today's searches by the clock, older ones by the date: "11:04" is only
   *  useful while it is still today. */
  function whenLabel(iso) {
    var d = new Date(iso.replace(" ", "T"));
    if (isNaN(d)) return "";
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toTimeString().slice(0, 5);
    var loc = lang === "uk" ? "uk-UA" : "en-GB";
    return d.toLocaleDateString(loc, { day: "numeric", month: "short" });
  }

  function openSugg() { suggOpen = true; paintRecent(); }
  function closeSugg() { suggOpen = false; suggAll = false; paintRecent(); }

  function paintQuota(node) {
    var q = A && A.quota();
    node.textContent = A ? A.quotaLabel() : "";
    node.classList.toggle("low", !!(q && q.remaining != null && q.remaining <= 1));
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
    if (A) A.currentUid = null;
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

  /* Some translated fields arrive with the machinery still in them: a line
   * reading "admission_requirements_raw:" sitting in the middle of the Ukrainian
   * description, because the translation step was handed several fields at once
   * with their column names as separators and kept the separators. The
   * catalogue is the place to fix that, and it is fixed there too — but a
   * reader should not be shown a column name while a rebuild is pending, and
   * the same thing will happen again the next time a field is batched.
   *
   * Only lines that are nothing but a snake_case identifier and a colon go.
   * The underscore is what makes it safe: no sentence in either language is a
   * lone lowercase word with an underscore in it. */
  var FIELD_MARKER = /^[ \t]*[a-z][a-z0-9]*(?:_[a-z0-9]+)+[ \t]*:[ \t]*$/;

  function stripFieldMarkers(s) {
    if (!s || s.indexOf("_") === -1) return s;
    return s.split("\n")
      .filter(function (line) { return !FIELD_MARKER.test(line); })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function txt(p, field) {
    var value = (lang === "uk" && UK_FIELD[field] && p[UK_FIELD[field]]) ? p[UK_FIELD[field]] : p[field];
    return typeof value === "string" ? stripFieldMarkers(value) : value;
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

  /* ---------- what a stranger gets ----------
   *
   * Two programmes in full, then the wall. Kept in this browser rather than on
   * the server, and knowingly: /api/program is public, so anyone who wants the
   * data can still have it. That is the right trade — this is not protecting a
   * secret, it is choosing the moment to ask, and the moment is after the
   * catalogue has already answered two real questions.
   *
   * A programme already opened never counts twice: coming back to the one you
   * are still reading must not be what spends your last look.
   */
  var VIEWED_KEY = "kounsly.viewed";

  function viewedUids() {
    try { return JSON.parse(localStorage.getItem(VIEWED_KEY)) || []; } catch (e) { return []; }
  }

  function rememberViewed(uid) {
    var seen = viewedUids();
    if (seen.indexOf(uid) >= 0) return;
    seen.push(uid);
    try { localStorage.setItem(VIEWED_KEY, JSON.stringify(seen.slice(-50))); } catch (e) {}
  }

  function viewAllowed(uid) {
    if (!A || !A.enabled || A.signedIn()) return true;
    var seen = viewedUids();
    var limit = A.anonViews ? A.anonViews() : 2;
    return seen.indexOf(uid) >= 0 || seen.length < limit;
  }

  function openSheet(uid) {
    // Remembered for the round trip to Google or Apple: signing in is a full
    // page load, and coming back to a blank home page loses the very programme
    // they were signing in to save. Set before the wall as well as after it —
    // the programme they were refused is exactly the one to open on the way
    // back.
    if (A) A.currentUid = uid;
    if (!viewAllowed(uid)) { A.openGate("view", function () { openSheet(uid); }); return; }
    rememberViewed(uid);

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
    var dl = nextDeadline(ownDeadlines(p.deadlines));
    var free = p.tuition_free === 1 || p.tuition_eur_year === 0;

    function tile(labelKey, value, extra) {
      var words = !/\d/.test(String(value));
      return '<div class="tile' + (extra || "") + '"><b>' + esc(T(labelKey)) + "</b>" +
        '<span class="' + (words ? "words" : "") + '">' + esc(value) + "</span></div>";
    }

    var tiles = [
      tile("f_tuition", money(p, true), free ? " free" : ""),
      tile("d_semester", (p.semester_fee_raw && shortFee(txt(p, "semester_fee_raw"))) ||
                         (p.semester_fee_raw ? T("see_below") : T("not_listed"))),
      tile("d_living", p.cost_of_living_eur_month ? "≈ €" + p.cost_of_living_eur_month : T("not_listed")),
      tile("f_english", englishLabel(p)),
      tile(p.duration_raw ? "f_duration" : "f_ects", p.duration_raw || p.ects || T("not_listed")),
      tile("f_deadline", dl ? dateLabel(dl) : T("not_listed"))
    ].join("");

    // Every date says what kind of deadline it is — regular, early admission, or
    // for a particular group of applicants. Three unexplained dates read as a
    // bug; the source distinguished them all along. Now that there is an account
    // behind it, the one that is *theirs* is marked — and only when the profile
    // actually says which group they are in. Unknown stays unmarked rather than
    // guessing: telling someone the wrong date costs them a year.
    var deadlineRows = (p.deadlines || []).map(function (d) {
      var one = nextDeadline([d]);
      var mine = isMyDeadline(d);
      return '<div class="deadline-row' + (mine ? " mine" : "") + '">' +
        '<span class="date">' + esc(dateLabel(d)) + "</span>" +
        '<span class="who">' + esc(deadlineKind(d)) +
          (mine ? " · " + esc(T("my_deadline")) : "") + "</span>" +
        '<span class="left">' + esc(one ? daysLabel(one.days) : "") + "</span></div>";
    }).join("");

    var gaps = eligibility(p);

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
        actsHTML(p) +

        // Comparison, not a verdict: the numbers the page states against the
        // numbers the reader gave us. Shown only when both exist, and only ever
        // as a gap — whether they are admitted is the university's to say.
        (gaps.length
          ? '<div class="grp"><h3>' + esc(T("el_title")) + "</h3>" +
              gaps.map(function (g) {
                return '<div class="step missing"><span class="step-n">!</span>' +
                  '<div class="step-b"><div class="step-v">' + esc(g.text) + "</div></div></div>";
              }).join("") +
            "</div>"
          : "") +

        group("g_money", [
          // Pass null rather than the "not listed" string, so an unknown fee gets
          // the missing state with a link instead of a dead end.
          block(p, "f_tuition", null, {
            value: (p.tuition_free === 1 || p.tuition_eur_year != null) ? money(p) : null,
            required: true, figure: true
          }),
          block(p, "d_semester", "semester_fee_raw", { required: true }),
          // The figure and the prose come from different places: the prose is a
          // named field on the page, the number is whatever figure the extractor
          // found anywhere in the text. Either can exist without the other, and
          // when only the number did, this row said "the official page does not
          // state this" directly under a tile reading "≈ €950". Both were about
          // the page and only one of them was true.
          block(p, "d_living", "cost_of_living_raw", {
            required: true,
            value: txt(p, "cost_of_living_raw") ||
                   (p.cost_of_living_eur_month ? "≈ €" + p.cost_of_living_eur_month + " " + T("per_month") : null)
          }),
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
  /** The figure out of a fee sentence, or nothing.
   *
   *  It used to fall back to the first 28 characters and an ellipsis, which put
   *  "Семестровий внесок у Univers…" in a tile sized for "€172" — a stat tile
   *  reading as a truncated sentence, with the real answer nowhere in it. There
   *  is no short honest version of a paragraph, so say where it is instead: the
   *  full text is already in the money section, a screen further down. */
  function shortFee(text) {
    var m = String(text).match(/([\d][\d.,]*)\s*(?:€|EUR)/i);
    return m ? "€" + m[1] : null;
  }

  /* ---------- assistant ---------- */

  /* The conversation is page content; only the box you type into is furniture.
   *
   * These used to be one sticky element, and that is what froze the detail
   * sheet. `.ask` was `position:sticky; bottom:0` with the thread inside it, so
   * every answer made the sticky block taller — and a bottom-stuck element
   * taller than its scrollport is pinned by its bottom edge and painted over
   * everything else. Two questions in, it covered the whole sheet: the
   * programme text above was unreachable, the top of the conversation had been
   * pushed off-screen, and scrolling appeared to do nothing at all.
   *
   * So the thread sits in normal flow and scrolls with the rest of the sheet,
   * and only `.ask-bar` — quote, field, hint — stays stuck to the bottom. */
  function askHTML() {
    return '<div class="ask">' +
      '<div class="thread" id="thread"></div>' +
      '<div class="ask-bar">' +
        '<div class="ask-quote" id="ask-quote"></div>' +
        '<form class="ask-form" id="ask-form">' +
          '<input id="ask-input" type="text" autocomplete="off" placeholder="' + esc(T("ask_ph")) + '">' +
          '<button type="submit">' + esc(T("ask_send")) + "</button>" +
        "</form>" +
        '<div class="ask-hint">' + esc(T("ask_hint")) +
          ' <span class="ask-left" id="ask-left"></span></div>' +
      "</div>" +
      "</div>";
  }

  /** Bring a message into view inside the sheet, allowing for the bar parked
   *  over the bottom of it. scrollIntoView is no good here: the wrapper behind
   *  the sheet scrolls too, so the browser is free to move that one instead,
   *  and `block:"nearest"` counts the message as visible when it is sitting
   *  behind the composer. */
  function revealInSheet(node) {
    var body = document.querySelector(".sheet-body");
    if (!body || !node) return;
    var bar = body.querySelector(".ask-bar");
    var pad = (bar ? bar.offsetHeight : 0) + 12;
    var over = node.getBoundingClientRect().bottom - (body.getBoundingClientRect().bottom - pad);
    if (over > 0) body.scrollTop += over;
  }

  var selection = null;

  /** Out of free questions, and no account to raise the limit. Read from the
   *  meter the server keeps rather than counted here: the same device may have
   *  spent its questions in another tab. */
  function outOfAsks() {
    if (!A || !A.enabled || A.signedIn()) return false;
    var q = A.quota();
    return !!(q && q.scope === "anon" && q.remaining != null && q.remaining <= 0);
  }

  function wireAsk(p) {
    var form = $("ask-form"), input = $("ask-input"), thread = $("thread");
    selection = null;
    renderQuote();
    var left = $("ask-left");
    if (left) paintQuota(left);
    if (outOfAsks()) lockAsk();

    /* The wall, and what it leaves behind. Closing it with the ✕ has to leave
     * the reader somewhere, and an empty box that silently refuses to send is
     * the one thing it must not be: the invitation stays in the conversation,
     * with the button on it, so the way in is still there after the full-screen
     * version is gone. */
    function lockAsk() {
      input.disabled = true;
      input.value = "";
      input.placeholder = T("ask_locked_ph");
      form.querySelector("button").disabled = true;
      if ($("ask-wall")) return;
      var wall = el("div", "msg ai wall");
      wall.id = "ask-wall";
      wall.appendChild(el("div", "wall-t", T("ask_wall")));
      var btn = el("button", "wall-btn", T("ask_wall_btn"));
      btn.type = "button";
      btn.onclick = function () { A.openGate("ask", null); };
      wall.appendChild(btn);
      thread.appendChild(wall);
      revealInSheet(wall);
    }

    function unlockAsk() {
      var wall = $("ask-wall");
      if (wall) wall.remove();
      input.disabled = false;
      input.placeholder = T("ask_ph");
      form.querySelector("button").disabled = false;
    }

    function wall(question, quoted) {
      lockAsk();
      A.openGate("ask", function () {
        unlockAsk();
        if (question) send(question, quoted);
      });
    }

    function send(question, quoted) {
      asking = true;
      thread.appendChild(el("div", "msg me", question));
      var wait = el("div", "msg ai dots", T("ask_wait"));
      thread.appendChild(wait);
      revealInSheet(wait);

      var body = { uid: p.uid, question: question, selection: quoted, lang: lang };
      if (A) body.anon_id = A.anonId();

      // Through auth.fetch so the token rides along when there is one: the same
      // question is metered against the account rather than the device.
      return (A ? A.fetch : fetch)("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (res) {
          wait.remove();
          if (res.status === 429) { thread.appendChild(el("div", "msg ai err", T("ask_limit"))); return; }

          // Out of questions. For a signed-out reader that is an offer, and the
          // wall asks the question they had already typed once there is an
          // account — losing it would make signing in feel like a punishment.
          // For someone already signed in there is nothing to offer yet, so say
          // so plainly rather than showing them a login box they don't need.
          if (res.status === 402 && A) {
            if (A.signedIn()) {
              thread.appendChild(el("div", "msg ai err", T("ask_month")));
              return;
            }
            thread.lastChild.remove();          // take the unanswered question back
            wall(question, quoted);
            return;
          }
          if (!res.ok || !res.d.answer) { thread.appendChild(el("div", "msg ai err", T("ask_err"))); return; }

          if (res.d.quota && A) A.setQuota(res.d.quota);
          var answer = el("div", "msg ai");
          answer.innerHTML = linkify(res.d.answer);
          thread.appendChild(answer);
          revealInSheet(answer);
          // The one just answered was the last one: say so now, on the answer
          // they are already reading, rather than when they next press send.
          if (outOfAsks()) lockAsk();
        })
        .catch(function () { wait.remove(); thread.appendChild(el("div", "msg ai err", T("ask_err"))); })
        .finally(function () { asking = false; });
    }

    form.onsubmit = function (e) {
      e.preventDefault();
      var question = input.value.trim();
      if (!question || asking) return;
      var quoted = selection;
      // Asked before the round trip, so a question typed with nothing left
      // opens the wall instead of spending a request to be told 402 — and the
      // question is kept, to be asked for them once there is an account.
      if (outOfAsks()) { wall(question, quoted); return; }
      input.value = "";
      selection = null;
      renderQuote();
      send(question, quoted);
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
    // The attribute is already set by the inline script in index.html; this
    // only keeps it in step with the system for as long as nobody has chosen.
    // Someone who has chosen keeps their choice — including when their phone
    // switches at sunset.
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var follow = function () {
      if (localStorage.getItem("kounsly.theme")) return;
      root.setAttribute("data-theme", mq.matches ? "dark" : "light");
      paintTheme();
    };
    if (mq.addEventListener) mq.addEventListener("change", follow);
    else if (mq.addListener) mq.addListener(follow);

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
    $("go").addEventListener("click", function () { closeSugg(); state.q = $("q").value.trim(); state.page = 1; state.ai = true; runSearch(); });
    $("q").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { closeSugg(); state.q = $("q").value.trim(); state.page = 1; state.ai = true; runSearch(); }
      if (e.key === "Escape") closeSugg();
    });

    // The panel opens on focus and closes on anything that isn't it. Not on
    // blur: the ✕ inside a row takes focus away from the field, and closing
    // there would make one row disappear along with the whole panel.
    $("q").addEventListener("focus", openSugg);
    document.addEventListener("click", function (e) {
      if (!suggOpen) return;
      if (e.target.closest && e.target.closest(".sbox")) return;
      closeSugg();
    });

    [["f-region", "country"], ["f-country", "area"], ["f-field", "subject"], ["f-level", "level"], ["f-budget", "budget"], ["f-sort", "sort"]]
      .forEach(function (pair) {
        $(pair[0]).addEventListener("change", function () { state[pair[1]] = this.value; state.page = 1; runSearch(); });
      });

    $("f-free").addEventListener("change", function () { state.free = this.checked; state.page = 1; runSearch(); });

    // A disabled select never sees the click, so the group around it answers
    // for it. Pressing a locked filter is the clearest statement of intent
    // there is — it opens the wall rather than doing nothing.
    document.querySelectorAll(".filters [data-gated]").forEach(function (g) {
      g.addEventListener("click", function () {
        if (g.classList.contains("locked") && A) A.openGate("filter", null);
      });
    });
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
      applyI18n(); buildSelects(); applyFilterLocks();
      if (A) A.refresh();          // the header and the sign-in box are translated too
      if (current) openSheet(current.uid);
      runSearch();
    });

    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  }

  /* Where a search starts from, when the profile says something about it.
   *
   * Only ever a starting position, and only into filters the reader has not
   * touched: a profile that silently narrows a search someone is already in
   * the middle of would be the same mistake as a deadline shown without saying
   * whose it is. Everything it sets is visible in the filter column and
   * clearable with one click on "reset".
   */
  function applyProfileDefaults() {
    var p = profile();
    if (!p) return false;
    var touched = false;
    if (!state.level && p.want_level && p.want_level !== "any") { state.level = p.want_level; touched = true; }
    if (!state.budget && !state.free && p.budget_max != null) {
      if (Number(p.budget_max) === 0) { state.free = true; $("f-free").checked = true; }
      else state.budget = String(p.budget_max);
      touched = true;
    }
    if (touched) buildSelects();
    return touched;
  }

  /* What the account page borrows. The saved list has to be the same card as a
   * search result — same star, same eligibility line, same "your deadline" —
   * and the only way to guarantee that is for there to be one card renderer. */
  window.KounslyApp = {
    card: card,
    openSheet: openSheet,
    ownDeadlines: ownDeadlines,
    nextDeadline: nextDeadline,
    isMyDeadline: isMyDeadline,
    dateLabel: dateLabel,
    daysLabel: daysLabel,
    deadlineWho: function (appliesTo) { return T("dl_" + appliesTo); },
    countryName: countryName,
    applyProfileDefaults: applyProfileDefaults
  };

  applyI18n();
  bind();
  bindTheme();
  if (A) A.onShowSaved = showSaved;

  /* Both requests are local and go out together, so waiting for the account
   * before the first render costs nothing — and it means cards are drawn with
   * their stars already in the right state rather than visibly filling in a
   * moment later. */
  Promise.all([
    A ? A.init(syncAuthUI) : Promise.resolve(null),
    fetch("/api/facets").then(function (r) { return r.json(); }).catch(function () { return null; })
  ]).then(function (both) {
    facets = both[1];
    if (facets) buildSelects();
    // After facets, before the first search: the filters have to exist before
    // a profile can preselect anything in them.
    applyProfileDefaults();
    applyFilterLocks();
    runSearch();
    // Back from Google or Apple: reopen what they were reading.
    var resume = A && A.resumeUid();
    if (resume) openSheet(resume);
  });
})();
