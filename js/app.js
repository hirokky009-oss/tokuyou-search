/**
 * app.js — 検索・フィルタ・ソート・一覧描画（メインコントローラ）
 */
"use strict";

(() => {
  if (!window.TOKUYO_DATA) {
    document.getElementById("result-count").textContent =
      "データ読込エラー：batch/build_data.py を実行して site/data/facilities.js を生成してください。";
    return;
  }

  const DATA = window.TOKUYO_DATA;
  const GSI_API = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";

  const state = {
    center: { lat: DATA.meta.center.lat, lon: DATA.meta.center.lon, label: DATA.meta.center.label },
    bandMin: 0,       // 距離帯の下限km（例: 2〜5km帯なら 2）
    bandMax: 2,       // 距離帯の上限km
    mode: "both",     // car | train | both (FR-02-4)
    sort: "distance",
    markFilter: "all",  // all | fav | ng | memo | marked | hide-ng
    keyword: "",
    homeStation: null,
  };

  // 距離帯を無視して全件から抽出するフィルタ（気になる施設は距離帯をまたいで探したいため）
  const BAND_IGNORING_FILTERS = ["fav", "ng", "memo", "marked"];

  // ---- チェック・メモ（保存先は store.js が管理: Firebase共有 or localStorage） ----
  function getMark(id) {
    return MarkStore.get(id);
  }

  function setMark(id, patch) {
    MarkStore.set(id, patch);
  }

  const el = {
    input: document.getElementById("address-input"),
    searchBtn: document.getElementById("search-btn"),
    geoMsg: document.getElementById("geo-message"),
    radiusSeg: document.getElementById("radius-seg"),
    modeSeg: document.getElementById("mode-seg"),
    sortSelect: document.getElementById("sort-select"),
    keywordInput: document.getElementById("keyword-input"),
    count: document.getElementById("result-count"),
    list: document.getElementById("card-list"),
    dataNote: document.getElementById("data-note"),
  };

  // ---- 初期化 ----
  function initialize() {
    el.dataNote.textContent =
      `情報時点：${DATA.meta.source_csv_date}（データ生成日：${DATA.meta.generated_at}）／掲載 ${DATA.meta.count} 施設（${DATA.meta.center.label}から${DATA.meta.radius_km}km圏）`
      + (DATA.meta.details_fetched
        ? `／費用・待機者数：${DATA.meta.details_fetched}取得（施設が年1回報告する公表値のため、現在の人数とは異なる場合があります）`
        : "");
    MapView.init(state.center);
    MapView.setPinClickHandler(highlightCard);
    // 保存層を初期化。他端末での変更（Firebase共有時）が届いたら一覧を再描画
    MarkStore.init(() => refresh());
    bindEvents();
    refresh();
  }

  function bindEvents() {
    el.searchBtn.addEventListener("click", onSearch);
    el.input.addEventListener("keydown", e => { if (e.key === "Enter") onSearch(); });

    el.radiusSeg.addEventListener("click", e => {
      const btn = e.target.closest("button[data-max]");
      if (!btn) return;
      state.bandMin = Number(btn.dataset.min);
      state.bandMax = Number(btn.dataset.max);
      setActive(el.radiusSeg, btn);
      refresh();
    });
    el.modeSeg.addEventListener("click", e => {
      const btn = e.target.closest("button[data-mode]");
      if (!btn) return;
      state.mode = btn.dataset.mode;
      setActive(el.modeSeg, btn);
      refresh();
    });
    el.sortSelect.addEventListener("change", () => {
      state.sort = el.sortSelect.value;
      refresh();
    });
    document.getElementById("mark-seg").addEventListener("click", e => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      state.markFilter = btn.dataset.filter;
      setActive(document.getElementById("mark-seg"), btn);
      // 気になる／対象外／メモなどの抽出は、選んだ距離帯の外にある施設も取りこぼさないよう距離帯を「すべて」にする
      if (BAND_IGNORING_FILTERS.includes(state.markFilter)) {
        state.bandMin = 0;
        state.bandMax = 150;
        setActive(el.radiusSeg, el.radiusSeg.querySelector('[data-min="0"][data-max="150"]'));
      }
      refresh();
    });
    el.keywordInput.addEventListener("input", () => {
      state.keyword = el.keywordInput.value.trim();
      refresh();
    });
  }

  function setActive(seg, btn) {
    seg.querySelectorAll("button").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }

  // ---- 住所検索（FR-01-1 / FR-01-4） ----
  async function onSearch() {
    const q = el.input.value.trim();
    hideGeoMessage();
    if (!q) return;
    el.searchBtn.disabled = true;
    el.searchBtn.textContent = "検索中…";
    try {
      const res = await fetch(GSI_API + encodeURIComponent(q));
      const results = await res.json();
      if (!results || results.length === 0) {
        showGeoMessage("住所が見つかりませんでした。市区町村名から入力してみてください。", []);
      } else if (results.length === 1) {
        applyCenter(results[0]);
      } else {
        // 複数候補 → 選択肢を提示（FR-01-4）
        showGeoMessage("もしかして：", results.slice(0, 5));
      }
    } catch (err) {
      showGeoMessage("住所検索サービスに接続できませんでした。通信環境をご確認ください。", []);
    } finally {
      el.searchBtn.disabled = false;
      el.searchBtn.textContent = "🔍 検索";
    }
  }

  function applyCenter(gsiResult) {
    const [lon, lat] = gsiResult.geometry.coordinates;
    state.center = { lat, lon, label: gsiResult.properties.title };
    el.input.value = gsiResult.properties.title;
    hideGeoMessage();
    MapView.drawHome(state.center);
    refresh();
  }

  function showGeoMessage(text, candidates) {
    el.geoMsg.innerHTML = "";
    el.geoMsg.append(text);
    for (const c of candidates) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "📍 " + c.properties.title;
      b.addEventListener("click", () => applyCenter(c));
      el.geoMsg.appendChild(b);
    }
    el.geoMsg.hidden = false;
  }

  function hideGeoMessage() { el.geoMsg.hidden = true; }

  // ---- 一覧更新 ----
  function refresh() {
    state.homeStation = Score.findHomeStation(DATA.facilities, state.center);

    // 全施設を評価してから距離帯フィルタ（bandMin < d ≤ bandMax）＋キーワード＋チェックフィルタ
    const kw = state.keyword.toLowerCase();
    const visible = [];
    for (const f of DATA.facilities) {
      f._eval = Score.evaluate(f, state.center, state.homeStation, state.mode);
      const inBand = (f._eval.distanceKm > state.bandMin && f._eval.distanceKm <= state.bandMax) ||
        (state.bandMin === 0 && f._eval.distanceKm === 0);
      if (!inBand) continue;
      if (kw && !(f.name.toLowerCase().includes(kw) || (f.city || "").toLowerCase().includes(kw))) continue;
      const markData = getMark(f.id);
      const m = markData.mark;
      const hasMemo = !!(markData.memo && markData.memo.trim());
      if (state.markFilter === "fav" && m !== "fav") continue;
      if (state.markFilter === "ng" && m !== "ng") continue;
      if (state.markFilter === "memo" && !hasMemo) continue;
      if (state.markFilter === "marked" && !(m === "fav" || m === "ng" || hasMemo)) continue;
      if (state.markFilter === "hide-ng" && m === "ng") continue;
      visible.push(f);
    }

    sortFacilities(visible);
    renderCount(visible);
    renderList(visible);
    MapView.updatePins(visible);
    MapView.setBand(state.bandMin, state.bandMax);
    if (BAND_IGNORING_FILTERS.includes(state.markFilter)) {
      MapView.fitToFacilities(visible, state.center, state.bandMax);
    } else {
      MapView.fitToRadius(state.center, state.bandMax);
    }
  }

  function bandLabel() {
    if (state.bandMin === 0 && state.bandMax === 150) return "150km圏すべて";
    if (state.bandMin === 0) return `${state.bandMax}km以内`;
    return `${state.bandMin}〜${state.bandMax}km`;
  }

  /** 入りやすさの目安: 待機者数÷定員（低いほど入りやすい）。待機未取得は末尾 */
  function waitingRatio(f) {
    if (f.waiting === null || f.waiting === undefined) return Infinity;
    return f.waiting / (f.capacity || 70);  // 定員未記載は平均的な70床とみなす
  }

  /** 月額費用の目安（下限）。未取得は末尾 */
  function feeValue(f) {
    if (!f.fee || !f.fee.monthly_estimate) return Infinity;
    return f.fee.monthly_estimate.min;
  }

  function sortFacilities(list) {
    const by = {
      distance: (a, b) => a._eval.distanceKm - b._eval.distanceKm,
      total: (a, b) => (b._eval.total ?? -1) - (a._eval.total ?? -1) || a._eval.distanceKm - b._eval.distanceKm,
      fee: (a, b) => feeValue(a) - feeValue(b) || a._eval.distanceKm - b._eval.distanceKm,
      easiness: (a, b) => waitingRatio(a) - waitingRatio(b) || a._eval.distanceKm - b._eval.distanceKm,
      capacity: (a, b) => (b.capacity ?? -1) - (a.capacity ?? -1) || a._eval.distanceKm - b._eval.distanceKm,
    };
    list.sort(by[state.sort] || by.distance);
  }

  const MARK_FILTER_LABEL = {
    fav: "⭐気になるのみ", ng: "❌対象外のみ", memo: "📝メモありのみ",
    marked: "📌チェック・メモ済み全部", "hide-ng": "❌対象外を除く",
  };

  function renderCount(visible) {
    const sortLabel = { distance: "距離順", total: "総合評価順", fee: "価格が安い順", easiness: "入りやすさ順", capacity: "定員順" }[state.sort];
    const markLabel = MARK_FILTER_LABEL[state.markFilter];
    const bandPart = BAND_IGNORING_FILTERS.includes(state.markFilter) ? "全件から抽出" : bandLabel();
    let text = `${visible.length}件（${bandPart}・${sortLabel}`;
    if (markLabel) text += `・${markLabel}`;
    if (state.keyword) text += `・「${state.keyword}」で絞込`;
    text += "）";
    el.count.textContent = text;
  }

  const PAGE_SIZE = 100; // 広域検索時の描画パフォーマンス対策（NFR-01）

  function renderList(visible) {
    el.list.innerHTML = "";
    if (visible.length === 0) {
      const div = document.createElement("div");
      div.className = "empty-message";
      div.innerHTML = "この条件では施設が見つかりませんでした。<br>";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "すべて（150km圏）を表示";
      btn.addEventListener("click", () => {
        state.bandMin = 0;
        state.bandMax = 150;
        setActive(el.radiusSeg, el.radiusSeg.querySelector('[data-min="0"][data-max="150"]'));
        refresh();
      });
      div.appendChild(btn);
      el.list.appendChild(div);
      return;
    }
    appendCards(visible, 0);
  }

  /** offset 位置から PAGE_SIZE 件ずつカードを追加描画 */
  function appendCards(visible, offset) {
    const frag = document.createDocumentFragment();
    const end = Math.min(offset + PAGE_SIZE, visible.length);
    for (let i = offset; i < end; i++) frag.appendChild(buildCard(visible[i]));
    el.list.appendChild(frag);

    const oldBtn = document.getElementById("show-more-btn");
    if (oldBtn) oldBtn.remove();
    if (end < visible.length) {
      const wrap = document.createElement("div");
      wrap.className = "empty-message";
      wrap.id = "show-more-btn";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `さらに表示（残り ${visible.length - end} 件）`;
      btn.addEventListener("click", () => {
        wrap.remove();
        appendCards(visible, end);
      });
      wrap.appendChild(btn);
      el.list.appendChild(wrap);
    }
  }

  function buildCard(f) {
    const ev = f._eval;
    const stars = Score.toStars(ev.total);
    const card = document.createElement("article");
    card.className = "facility-card";
    card.id = "card-" + f.id;

    const trainTxt = ev.train
      ? `🚃約${ev.train.minutes}分`
      : `<span class="dist">🚃 −</span>`;
    const scoreNum = ev.total !== null ? `<span class="score-num">${(ev.total / 20).toFixed(1)}</span>` : "";
    const capTxt = f.capacity ? `定員${f.capacity_estimated ? "約" : ""}${f.capacity}名` : "定員 −";

    // 💰 月額目安（1割負担・第4段階・要介護1〜5のレンジ）
    const fee = f.fee && f.fee.monthly_estimate
      ? `💰 月${(f.fee.monthly_estimate.min / 10000).toFixed(1)}〜${(f.fee.monthly_estimate.max / 10000).toFixed(1)}万円`
      : `<span class="dist">💰 月額 要問合せ</span>`;
    const waiting = f.waiting !== null && f.waiting !== undefined ? ` ｜ 待機${f.waiting}人` : "";
    const rooms = f.room_types
      ? [f.room_types.private ? `個室${f.room_types.private}室` : "", f.room_types.multi ? `多床${f.room_types.multi}室` : ""].filter(Boolean).join("・")
      : "";

    card.innerHTML = `
      <div class="card-top">
        <span class="card-name">${MapView.escapeHtml(f.name)}</span>
        <span class="card-stars">${Score.starLabel(stars)} ${scoreNum}</span>
      </div>
      <div class="card-access">🚗約${ev.carMin}分 ${trainTxt}
        <span class="dist">（${ev.distanceKm}km・${MapView.escapeHtml(f.city)}）</span>
      </div>
      <div class="card-info">${fee}${waiting}${rooms ? ` ｜ ${rooms}` : ""}</div>
      <div class="card-info">${MapView.escapeHtml(f.type)} ｜ ${capTxt}${f.nearest_station ? ` ｜ ${MapView.escapeHtml(f.nearest_station.name)}駅 徒歩${f.nearest_station.walk_min}分` : ""}</div>
      <div class="card-links"></div>
      <div class="card-marks">
        <button type="button" class="mark-btn mark-fav">⭐ 気になる</button>
        <button type="button" class="mark-btn mark-ng">❌ 対象外</button>
        <button type="button" class="mark-btn memo-toggle">📝 メモ</button>
      </div>
      <div class="memo-area" hidden>
        <textarea rows="2" placeholder="メモ（例：見学済み／待機が長い／母の希望 など）"></textarea>
      </div>`;

    applyMarkUI(card, f.id);

    const links = card.querySelector(".card-links");
    // Googleマップの実経路（自宅→施設）: 車・電車
    const origin = `${state.center.lat},${state.center.lon}`;
    const dest = `${f.lat},${f.lon}`;
    links.appendChild(makeLink(
      `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`,
      "🚗 車の経路"));
    links.appendChild(makeLink(
      `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=transit`,
      "🚃 電車・バスの乗換"));
    links.appendChild(makeLink(f.kouhyou_url, "📋 公的情報（公表システム）"));
    if (f.official_url) links.appendChild(makeLink(f.official_url, "🌐 公式サイト"));
    if (f.tel) {
      const tel = document.createElement("a");
      tel.href = "tel:" + f.tel.replace(/[^0-9+]/g, "");
      tel.textContent = "📞 " + f.tel;
      links.appendChild(tel);
    }
    return card;
  }

  /** チェック・メモUIの状態反映とイベント設定 */
  function applyMarkUI(card, id) {
    const m = getMark(id);
    const favBtn = card.querySelector(".mark-fav");
    const ngBtn = card.querySelector(".mark-ng");
    const memoBtn = card.querySelector(".memo-toggle");
    const memoArea = card.querySelector(".memo-area");
    const textarea = memoArea.querySelector("textarea");

    card.classList.toggle("fav", m.mark === "fav");
    card.classList.toggle("ng", m.mark === "ng");
    favBtn.classList.toggle("on", m.mark === "fav");
    ngBtn.classList.toggle("on", m.mark === "ng");
    textarea.value = m.memo || "";
    if (m.memo) {
      memoArea.hidden = false;
      memoBtn.classList.add("on");
    }

    favBtn.addEventListener("click", () => {
      const next = getMark(id).mark === "fav" ? null : "fav";
      setMark(id, { mark: next });
      applyMarkState(card, id);
    });
    ngBtn.addEventListener("click", () => {
      const next = getMark(id).mark === "ng" ? null : "ng";
      setMark(id, { mark: next });
      applyMarkState(card, id);
    });
    memoBtn.addEventListener("click", () => {
      memoArea.hidden = !memoArea.hidden;
      if (!memoArea.hidden) textarea.focus();
    });
    textarea.addEventListener("change", () => setMark(id, { memo: textarea.value.trim() }));
    textarea.addEventListener("blur", () => setMark(id, { memo: textarea.value.trim() }));
  }

  /** ボタン押下後の見た目だけ更新（再描画なし） */
  function applyMarkState(card, id) {
    const m = getMark(id);
    card.classList.toggle("fav", m.mark === "fav");
    card.classList.toggle("ng", m.mark === "ng");
    card.querySelector(".mark-fav").classList.toggle("on", m.mark === "fav");
    card.querySelector(".mark-ng").classList.toggle("on", m.mark === "ng");
  }

  function makeLink(href, label) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = label;
    return a;
  }

  function highlightCard(id) {
    document.querySelectorAll(".facility-card.highlighted").forEach(c => c.classList.remove("highlighted"));
    const card = document.getElementById("card-" + id);
    if (card) {
      card.classList.add("highlighted");
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  initialize();
})();
