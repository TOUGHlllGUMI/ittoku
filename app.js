(function () {
  const STORE_KEY = "ittoku:todos";
  const GROUPS = [
    ["late", "期限切れ"],
    ["today", "今日"],
    ["tomorrow", "明日"],
    ["week", "今週"],
    ["later", "もっと先"],
    ["none", "いつでも"],
  ];
  const $ = (id) => document.getElementById(id);

  let todos = load();
  let showDone = false;
  let editingId = null;
  let toastTimer = null;
  let newIds = new Set();

  // ---- 保存 ----

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY));
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(todos));
    } catch (e) {
      showToast("保存できませんでした");
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const dueOf = (t) => (t.due ? new Date(t.due) : null);

  // ---- 表示 ----

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function checkIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M5 12.5l4.5 4.5L19 7.5");
    svg.appendChild(path);
    return svg;
  }

  function itemNode(t, now) {
    const li = el("li", "item" + (t.done ? " done" : "") + (newIds.has(t.id) ? " is-new" : ""));
    li.dataset.id = t.id;
    const check = el("button", "check");
    check.type = "button";
    check.setAttribute("aria-label", t.done ? "まだにもどす" : "終わった");
    check.appendChild(checkIcon());
    check.addEventListener("click", () => toggleDone(t.id));
    const body = el("button", "item-body");
    body.type = "button";
    body.appendChild(el("span", "item-text", t.text));
    const due = dueOf(t);
    if (due) {
      const late = !t.done && groupOf(due, t.hasTime, now) === "late";
      body.appendChild(el("span", "due" + (late ? " late" : ""), formatDue(due, t.hasTime, now)));
    }
    body.addEventListener("click", () => openEdit(t.id));
    li.append(check, body);
    return li;
  }

  function sortByDue(a, b) {
    const da = a.due ? Date.parse(a.due) : Infinity;
    const db = b.due ? Date.parse(b.due) : Infinity;
    if (da !== db) return da - db;
    // 同じ日なら、時間のないもの(1日のどこか)を後ろに
    if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1;
    return a.createdAt - b.createdAt;
  }

  function render() {
    const now = new Date();
    const open = todos.filter((t) => !t.done);
    const done = todos.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

    const list = $("list");
    list.textContent = "";
    for (const [key, label] of GROUPS) {
      const items = open.filter((t) => groupOf(dueOf(t), t.hasTime, now) === key).sort(sortByDue);
      if (!items.length) continue;
      const section = el("div", "group");
      section.dataset.group = key;
      section.appendChild(el("h2", "group-head", label));
      const ul = el("ul", "items");
      for (const t of items) ul.appendChild(itemNode(t, now));
      section.appendChild(ul);
      list.appendChild(section);
    }

    $("empty").hidden = todos.length > 0;
    const todayCount = open.filter((t) => ["late", "today"].includes(groupOf(dueOf(t), t.hasTime, now))).length;
    $("summary").textContent = open.length ? `のこり ${open.length}件` + (todayCount ? ` ・ 今日まで ${todayCount}件` : "") : "";

    $("doneArea").hidden = done.length === 0;
    $("doneLabel").textContent = `終わったもの ${done.length}件`;
    $("doneToggle").setAttribute("aria-expanded", String(showDone));
    const doneList = $("doneList");
    doneList.hidden = !showDone;
    doneList.textContent = "";
    if (showDone) for (const t of done) doneList.appendChild(itemNode(t, now));
  }

  // ---- 操作 ----

  function addFromText(text) {
    const parsed = parseSpeech(text, new Date());
    if (!parsed.length) {
      showToast("やることが聞きとれませんでした");
      return [];
    }
    const added = parsed.map((p) => ({
      id: newId(),
      text: p.text,
      due: p.due ? p.due.toISOString() : null,
      hasTime: p.hasTime,
      done: false,
      createdAt: Date.now(),
    }));
    todos.push(...added);
    save();
    newIds = new Set(added.map((t) => t.id));
    render();
    setTimeout(() => {
      newIds = new Set();
      document.querySelectorAll(".item.is-new").forEach((n) => n.classList.remove("is-new"));
    }, 1600);
    const ids = added.map((t) => t.id);
    showToast(`${added.length}件入れました`, () => {
      todos = todos.filter((t) => !ids.includes(t.id));
      save();
      render();
      showToast("取り消しました");
    });
    return added;
  }

  function toggleDone(id) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    save();
    render();
  }

  $("doneToggle").addEventListener("click", () => {
    showDone = !showDone;
    render();
  });

  $("clearDone").addEventListener("click", () => {
    const count = todos.filter((t) => t.done).length;
    if (!confirm(`終わったもの ${count}件を消しますか?`)) return;
    todos = todos.filter((t) => !t.done);
    save();
    render();
  });

  // ---- 編集 ----

  function toDateValue(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function openEdit(id) {
    const t = todos.find((x) => x.id === id);
    if (!t) return;
    editingId = id;
    const due = dueOf(t);
    $("editText").value = t.text;
    $("editDate").value = due ? toDateValue(due) : "";
    $("editTime").value = due && t.hasTime ? `${pad2(due.getHours())}:${pad2(due.getMinutes())}` : "";
    $("editDialog").showModal();
  }

  $("clearWhen").addEventListener("click", () => {
    $("editDate").value = "";
    $("editTime").value = "";
  });

  $("deleteBtn").addEventListener("click", () => {
    const t = todos.find((x) => x.id === editingId);
    $("editDialog").close("delete");
    if (!t) return;
    const index = todos.indexOf(t);
    todos.splice(index, 1);
    save();
    render();
    showToast("消しました", () => {
      todos.splice(index, 0, t);
      save();
      render();
    });
  });

  $("editDialog").addEventListener("close", () => {
    if ($("editDialog").returnValue !== "save") return;
    const t = todos.find((x) => x.id === editingId);
    if (!t) return;
    const text = $("editText").value.trim();
    if (text) t.text = text;
    const date = $("editDate").value;
    const time = $("editTime").value;
    if (!date && !time) {
      t.due = null;
      t.hasTime = false;
    } else {
      const d = date ? new Date(date + "T00:00") : startOfDay(new Date());
      if (time) {
        const [h, m] = time.split(":").map(Number);
        d.setHours(h, m, 0, 0);
      }
      t.due = d.toISOString();
      t.hasTime = !!time;
    }
    save();
    render();
  });

  // ---- お知らせ ----

  function showToast(text, undo) {
    clearTimeout(toastTimer);
    $("toastText").textContent = text;
    const btn = $("toastBtn");
    btn.hidden = !undo;
    btn.onclick = undo
      ? () => {
          $("toast").hidden = true;
          undo();
        }
      : null;
    $("toast").hidden = false;
    toastTimer = setTimeout(() => ($("toast").hidden = true), undo ? 6000 : 3000);
  }

  // ---- 文字で入れる ----

  $("typeBtn").addEventListener("click", () => {
    const form = $("typeForm");
    form.hidden = !form.hidden;
    $("typeBtn").setAttribute("aria-pressed", String(!form.hidden));
    if (!form.hidden) $("typeInput").focus();
  });

  $("typeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("typeInput").value.trim();
    if (!text) return;
    if (addFromText(text).length) $("typeInput").value = "";
  });

  // ---- 声で入れる ----

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let finals = [];
  let interim = "";
  let errorCode = null;
  let silenceTimer = null;
  let heardTimer = null;

  function setListening(on) {
    document.body.classList.toggle("listening", on);
    $("micBtn").setAttribute("aria-label", on ? "聞きとりをやめる" : "話して入れる");
    $("hint").textContent = on ? "聞いています… もう一度押すと終わり" : "押して話す";
  }

  // スマホのChromeは、同じ言葉を少しずつ長くして何度も返すことがあるので、重なりを取りのぞく
  function collectSpeech(withInterim = true) {
    const parts = [];
    for (const t of finals.filter(Boolean)) {
      const last = parts[parts.length - 1];
      if (last && t.startsWith(last)) parts[parts.length - 1] = t;
      else if (last && last.includes(t)) continue;
      else parts.push(t);
    }
    if (withInterim && interim && !parts.some((p) => p.includes(interim))) parts.push(interim);
    return parts.join("、");
  }

  function showHeard() {
    const heard = $("heard");
    clearTimeout(heardTimer);
    heard.hidden = false;
    heard.textContent = "";
    const fixed = collectSpeech(false);
    heard.append(el("span", "", fixed));
    if (interim) heard.append(el("span", "interim", (fixed ? "、" : "") + interim));
  }

  function waitSilence(ms) {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => rec && rec.stop(), ms);
  }

  function startListening() {
    if (!Recognition) {
      showToast("このブラウザは声での入力に対応していません。文字で入れてください");
      $("typeForm").hidden = false;
      $("typeInput").focus();
      return;
    }
    finals = [];
    interim = "";
    errorCode = null;
    rec = new Recognition();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) finals[i] = text;
        else interim += text;
      }
      showHeard();
      waitSilence(2000); // 2秒だまったら終わり
    };
    rec.onerror = (e) => {
      errorCode = e.error;
    };
    rec.onend = finishListening;
    try {
      rec.start();
    } catch (e) {
      rec = null;
      showToast("マイクを使えませんでした");
      return;
    }
    setListening(true);
    clearTimeout(heardTimer);
    $("heard").hidden = false;
    $("heard").textContent = "どうぞ話してください";
    waitSilence(8000);
  }

  function finishListening() {
    clearTimeout(silenceTimer);
    rec = null;
    setListening(false);
    const text = collectSpeech();
    finals = [];
    interim = "";
    if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
      $("heard").hidden = true;
      showToast("マイクを使う許可をしてください");
      return;
    }
    if (errorCode === "network") {
      $("heard").hidden = true;
      showToast("ネットにつながっていないと聞きとれません");
      return;
    }
    if (!text) {
      $("heard").hidden = true;
      showToast("声が聞こえませんでした");
      return;
    }
    $("heard").textContent = `「${text}」`;
    addFromText(text);
    heardTimer = setTimeout(() => ($("heard").hidden = true), 4000);
  }

  $("micBtn").addEventListener("click", () => {
    $("micBtn").blur();
    if (rec) rec.stop();
    else startListening();
  });

  // 日付が変わったら「今日」「明日」を並べなおす
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) render();
  });
  setInterval(render, 60000);

  // 動作確認用:話した結果を、マイクなしで流しこむ
  window.ittoku = {
    addFromText,
    simulateSpeech(segments) {
      finals = segments.slice();
      interim = "";
      errorCode = null;
      finishListening();
    },
  };

  render();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
