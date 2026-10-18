// 話した文から ToDo を取り出す。画面には触らない関数だけを置く(ブラウザのコンソールから直接テストできる)。
//   parseSpeech("明日の3時に歯医者、牛乳買う", new Date())
//   → [{ text: "歯医者", due: Date, hasTime: true }, { text: "牛乳買う", due: Date, hasTime: false }]

const WEEKDAYS = "日月火水木金土";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// 二十三 → 23、十 → 10、二〇 → 20
function kanjiToNumber(s) {
  const digits = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!/[十百]/.test(s)) return String(Number([...s].map((c) => digits[c]).join("")));
  let total = 0;
  let cur = 0;
  for (const c of s) {
    if (c in digits) cur = digits[c];
    else if (c === "十") { total += (cur || 1) * 10; cur = 0; }
    else if (c === "百") { total += (cur || 1) * 100; cur = 0; }
  }
  return String(total + cur);
}

function normalizeSpeech(text) {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":")
    .replace(/／/g, "/")
    // 漢数字は、すぐ後ろに単位があるときだけ数字にする(「一緒」などを壊さない)
    .replace(/[〇零一二三四五六七八九十百]+(?=時|分|日|月|週|か月|ヶ月|カ月|ケ月|箇月)/g, kanjiToNumber)
    .trim();
}

// ---- 1つの話を、やることごとに分ける ----

// 「それから」「あと」などのつなぎ言葉。「あとで」「あと3日」は分けない
const CONNECTOR_RE = /それから|それと|あとは|あと(?!で|から|まで|少し|ちょっと|片付け|かたづけ|始末|\d)|次に|そして|ついでに|それに/g;
// 区切りなしで続けて言ったとき用:よく使う動詞の後ろで切る(「牛乳買う宿題やる」)
const VERB_END_RE = /(する|やる|買う|行く|出す|送る|返す|払う|書く|読む|洗う|作る|干す|取る|見る|寝る|捨てる|渡す|もらう|調べる|決める|しまう|片付ける|まとめる|入れる|届ける|直す|探す|聞く|飲む|磨く|拭く|戻す|集める|用意する|なきゃ|なくちゃ)(?=[^とかのよねなってもしこだでがをにへまぞわ前時日気人物所方ん、。\s])/g;

function splitChunks(text) {
  const raw = text
    .replace(CONNECTOR_RE, "\u0000")
    .replace(VERB_END_RE, "$1\u0000")
    .split(/[\u0000、。,，．!！?？\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 助詞で終わっているかけら(「歯医者の」で息つぎした、など)は次とつなげる
  const chunks = [];
  let carry = "";
  for (const part of raw) {
    const joined = carry + part;
    if (/[のをにへでとがはも]$/.test(joined) && part !== raw[raw.length - 1]) carry = joined;
    else { chunks.push(joined); carry = ""; }
  }
  if (carry) chunks.push(carry);
  return chunks;
}

// ---- 1つのかけらから、日付と時間を読み取って取りのぞく ----

const AFTER = "(?:ごろ|頃)?(?:までに|まで|からは|から|には|に|の|は|で)?";
const PERIOD_TIME = { 朝: [8, 0], 昼: [12, 0], 夕方: [17, 0], 夜: [20, 0], 晩: [20, 0] };

function extractWhen(chunk, now) {
  const today = startOfDay(now);
  let s = chunk;
  let date = null; // その日の 0:00
  let time = null; // { h, m, guess }  guess=午前/午後を言っていない
  let period = null; // 「明日の夜」の「夜」。あとの「8時」を夜の8時にする
  const take = (pattern, fn) => {
    const re = new RegExp(pattern);
    const m = s.match(re);
    if (!m) return;
    if (fn(m) === false) return;
    s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
  };
  const ifNoDate = (fn) => (m) => (date ? false : fn(m));
  const ifNoTime = (fn) => (m) => (time ? false : fn(m));
  const weekStart = (base) => addDays(base, -((base.getDay() + 6) % 7)); // 月曜はじまり

  // 「30分後」「2時間後」「3日後」「あと3日」「2週間後」「1か月後」
  take("(\\d+)分後" + AFTER, ifNoDate((m) => {
    const t = new Date(now.getTime() + Number(m[1]) * 60000);
    date = startOfDay(t);
    time = { h: t.getHours(), m: t.getMinutes() };
  }));
  take("(\\d+)時間後" + AFTER, ifNoDate((m) => {
    const t = new Date(now.getTime() + Number(m[1]) * 3600000);
    date = startOfDay(t);
    time = { h: t.getHours(), m: t.getMinutes() };
  }));
  take("(?:(\\d+)日後|あと(\\d+)日)" + AFTER, ifNoDate((m) => { date = addDays(today, Number(m[1] || m[2])); }));
  take("(\\d+)週間後" + AFTER, ifNoDate((m) => { date = addDays(today, Number(m[1]) * 7); }));
  take("(\\d+)(?:か|ヶ|カ|ケ|箇)月後" + AFTER, ifNoDate((m) => {
    date = new Date(today);
    date.setMonth(date.getMonth() + Number(m[1]));
  }));

  // 「10月20日」「10/20」
  take("(?:(\\d{4})年)?(\\d{1,2})月(\\d{1,2})日" + AFTER, ifNoDate((m) => {
    date = new Date(m[1] ? Number(m[1]) : today.getFullYear(), Number(m[2]) - 1, Number(m[3]));
    if (!m[1] && date < today) date.setFullYear(date.getFullYear() + 1);
  }));
  take("(?<![\\d/])(\\d{1,2})/(\\d{1,2})(?![\\d/])" + AFTER, ifNoDate((m) => {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
    date = new Date(today.getFullYear(), mo - 1, d);
    if (date < today) date.setFullYear(date.getFullYear() + 1);
  }));

  // 「来週の月曜」「金曜日」
  take("(今週|来週|再来週)?(?:の)?([日月火水木金土])曜(?:日)?" + AFTER, ifNoDate((m) => {
    const target = WEEKDAYS.indexOf(m[2]);
    if (m[1]) {
      const offset = { 今週: 0, 来週: 7, 再来週: 14 }[m[1]];
      date = addDays(weekStart(today), offset + ((target + 6) % 7));
    } else {
      let diff = (target - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      date = addDays(today, diff);
    }
  }));
  // 「週末」「来週末」
  take("(?:(今週|来週|再来週)|週)末" + AFTER, ifNoDate((m) => {
    const offset = { 今週: 0, 来週: 7, 再来週: 14 }[m[1] || "今週"];
    date = addDays(weekStart(today), offset + 5);
    if (date < today) date = today; // 日曜に「週末」と言ったら今日
  }));

  // 「今日」「明日の朝」「今夜」
  take("(しあさって|明々後日|明後日|あさって|明日|あした|今日|きょう|本日|今夜|今晩|今朝)(?:中|じゅう)?(?:の)?(朝|昼|夕方|夜|晩)?" + AFTER, ifNoDate((m) => {
    const days = { しあさって: 3, 明々後日: 3, 明後日: 2, あさって: 2, 明日: 1, あした: 1 }[m[1]] || 0;
    date = addDays(today, days);
    period = m[2] || { 今夜: "夜", 今晩: "夜", 今朝: "朝" }[m[1]];
    if (period && !time) time = { h: PERIOD_TIME[period][0], m: PERIOD_TIME[period][1], rough: true };
  }));

  // 「今週中」「来週」「今月中」「来月」「月末」「年内」
  take("(今週|来週|再来週)(中|いっぱい)?" + AFTER, ifNoDate((m) => {
    const offset = { 今週: 0, 来週: 7, 再来週: 14 }[m[1]];
    date = addDays(weekStart(today), offset + (m[1] === "今週" || m[2] ? 6 : 0));
  }));
  take("(今月|来月)(?:の)?(\\d{1,2})日" + AFTER, ifNoDate((m) => {
    date = new Date(today.getFullYear(), today.getMonth() + (m[1] === "来月" ? 1 : 0), Number(m[2]));
  }));
  take("(今月|来月)(末|中|いっぱい)?" + AFTER, ifNoDate((m) => {
    const plus = m[1] === "来月" ? 1 : 0;
    if (m[1] === "来月" && !m[2]) date = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    else date = new Date(today.getFullYear(), today.getMonth() + plus + 1, 0);
  }));
  take("月末" + AFTER, ifNoDate(() => { date = new Date(today.getFullYear(), today.getMonth() + 1, 0); }));
  take("(?:年内|今年中|今年いっぱい)" + AFTER, ifNoDate(() => { date = new Date(today.getFullYear(), 11, 31); }));

  // 「20日に」だけのとき:今月の20日(もう過ぎていれば来月)
  take("(?<!\\d)(\\d{1,2})日(?!後|間|中|分)" + AFTER, ifNoDate((m) => {
    const d = Number(m[1]);
    if (d < 1 || d > 31) return false;
    date = new Date(today.getFullYear(), today.getMonth(), d);
    if (date < today) date.setMonth(date.getMonth() + 1);
  }));

  // 時間
  take("正午" + AFTER, ifNoTime(() => { time = { h: 12, m: 0 }; }));
  take("(午前|午後|朝|昼|夕方|夜中|夜|晩)?(?:の)?(\\d{1,2})(?:時(?!間)(?:(\\d{1,2})分|(半))?|:(\\d{2}))" + AFTER, (m) => {
    let h = Number(m[2]);
    const min = m[4] ? 30 : Number(m[3] || m[5] || 0);
    if (h > 24 || min > 59) return false;
    const prefix = m[1] || period;
    if (["午後", "夕方", "夜", "晩"].includes(prefix) && h < 12) h += 12;
    if (["午前", "朝", "夜中"].includes(prefix) && h === 12) h = 0;
    let guess = false;
    if (!prefix && !m[5]) {
      if (h >= 1 && h <= 6) h += 12; // 「3時に歯医者」はふつう午後
      else if (h < 12) guess = true; // 「8時」は朝か夜か分からない
    }
    time = { h: h % 24, m: min, guess };
  });
  // 「夜に洗濯」(「朝ごはん」などは取らないよう、後ろに「に」があるときだけ)
  take("(朝|昼|夕方|夜|晩)(?:までに|に)", ifNoTime((m) => {
    time = { h: PERIOD_TIME[m[1]][0], m: PERIOD_TIME[m[1]][1], rough: true };
  }));

  return { text: cleanTaskText(s), date, time };
}

function cleanTaskText(s) {
  let t = s.replace(/\s+/g, "");
  let prev;
  do {
    prev = t;
    t = t
      .replace(/^(?:えーっと|えっと|えーと|ええと|えー|あのー|あの|うーん|まず|あと|忘れずに|とりあえず)/, "")
      .replace(/^[のにはでをもがへと、。]+/, "")
      .replace(/[、。のにはでをもがへと]+$/, "")
      .replace(/(?:だね|よね)$/, "");
  } while (t !== prev);
  return t;
}

function resolveDue(date, time, now) {
  if (!date && !time) return { due: null, hasTime: false };
  const due = date ? new Date(date) : startOfDay(now);
  if (!time) return { due, hasTime: false };
  let h = time.h;
  if (!date && time.guess) {
    // 「8時」:今日のその時間がもう過ぎていて、夜の8時ならまだ来ていないなら夜にする
    const morning = new Date(due);
    morning.setHours(h, time.m, 0, 0);
    const evening = new Date(due);
    evening.setHours(h + 12, time.m, 0, 0);
    if (morning < now && evening > now) h += 12;
  }
  due.setHours(h, time.m, 0, 0);
  if (!date && due < now) due.setDate(due.getDate() + 1);
  return { due, hasTime: true };
}

function parseSpeech(text, now = new Date()) {
  const chunks = splitChunks(normalizeSpeech(text));
  const items = [];
  let ctx = { date: null, time: null };
  let trailing = null; // 最後のやることの後ろに、日時だけが言われたとき
  for (const chunk of chunks) {
    const w = extractWhen(chunk, now);
    if (!w.text) {
      if (w.date) ctx.date = w.date;
      if (w.time) ctx.time = w.time;
      trailing = { date: w.date || (trailing && trailing.date), time: w.time || (trailing && trailing.time) };
      continue;
    }
    trailing = null;
    const date = w.date || ctx.date;
    const time = w.time || (w.date ? null : ctx.time);
    items.push({ text: w.text, date, time });
  }
  // 「牛乳買う、明日」:後ろの日時を直前のやることに付ける
  if (trailing && items.length) {
    const last = items[items.length - 1];
    if (!last.date && trailing.date) last.date = trailing.date;
    if (!last.time && trailing.time) last.time = trailing.time;
  }
  return items.map((it) => ({ text: it.text, ...resolveDue(it.date, it.time, now) }));
}

// ---- 表示用 ----

function dayDiff(due, now) {
  return Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDue(due, hasTime, now = new Date()) {
  if (!due) return "";
  const diff = dayDiff(due, now);
  const names = { "-2": "おととい", "-1": "昨日", 0: "今日", 1: "明日", 2: "あさって" };
  let day = names[diff];
  if (!day) {
    day = `${due.getMonth() + 1}月${due.getDate()}日(${WEEKDAYS[due.getDay()]})`;
    if (due.getFullYear() !== now.getFullYear()) day = `${due.getFullYear()}年` + day;
  }
  return hasTime ? `${day} ${due.getHours()}:${pad2(due.getMinutes())}` : day;
}

// 並べるグループ:late / today / tomorrow / week / later / none
function groupOf(due, hasTime, now = new Date()) {
  if (!due) return "none";
  const diff = dayDiff(due, now);
  if (diff < 0 || (hasTime && due < now)) return "late";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff < 7) return "week";
  return "later";
}
