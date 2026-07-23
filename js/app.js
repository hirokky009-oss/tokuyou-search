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
    homeStation: null,
  };

  const el = {
    input: document.getElementById("address-input"),
    searchBtn: document.getElementById("search-btn"),
    geoMsg: document.getElementById("geo-message"),
    radiusSeg: document.getElementById("radius-seg"),
    modeSeg: document.getElementById("mode-seg"),
    sortSelect: document.getElementById("sort-select"),
    count: document.getElementById("result-count"),
    list: document.getElementById("card-list"),
    dataNote: document.getElementById("data-note"),
  };

  // ---- 初期化 ----
  function initialize() {
    el.dataNote.textContent =
      `情報時点：${DATA.meta.source_csv_date}（データ生成日：${DATA.meta.generated_at}）／掲載 ${DATA.meta.count} 施設（${DATA.meta.center.label}から${DATA.meta.radius_km}km圏）`;
    MapView.init(state.center);
    MapView.setPinClickHandler(highlightCard);
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

    // 全施設を評価してから距離帯フィルタ（bandMin < d ≤ bandMax）
    const visible = [];
    for (const f of DATA.facilities) {
      f._eval = Score.evaluate(f, state.center, state.homeStation, state.mode);
      if (f._eval.distanceKm > state.bandMin && f._eval.distanceKm <= state.bandMax) visible.push(f);
      else if (state.bandMin === 0 && f._eval.distanceKm === 0) visible.push(f);
    }

    sortFacilities(visible);
    renderCount(visible);
    renderList(visible);
    MapView.updatePins(visible);
    MapView.setBand(state.bandMin, state.bandMax);
    MapView.fitToRadius(state.center, state.bandMax);
  }

  function bandLabel() {
    if (state.bandMin === 0 && state.bandMax === 50) return "50km圏すべて";
    if (state.bandMin === 0) return `${state.bandMax}km以内`;
    return `${state.bandMin}〜${state.bandMax}km`;
  }

  function sortFacilities(list) {
    const by = {
      distance: (a, b) => a._eval.distanceKm - b._eval.distanceKm,
      total: (a, b) => (b._eval.total ?? -1) - (a._eval.total ?? -1) || a._eval.distanceKm - b._eval.distanceKm,
      capacity: (a, b) => (b.capacity ?? -1) - (a.capacity ?? -1) || a._eval.distanceKm - b._eval.distanceKm,
    };
    list.sort(by[state.sort] || by.distance);
  }

  function renderCount(visible) {
    const sortLabel = { distance: "距離順", total: "総合評価順", capacity: "定員順" }[state.sort];
    el.count.textContent = `${visible.length}件（${bandLabel()}・${sortLabel}）`;
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
      btn.textContent = "すべて（50km圏）を表示";
      btn.addEventListener("click", () => {
        state.bandMin = 0;
        state.bandMax = 50;
        setActive(el.radiusSeg, el.radiusSeg.querySelector('[data-min="0"][data-max="50"]'));
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
    const capTxt = f.capacity ? `定員${f.capacity}名` : "定員 −";

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
      <div class="card-links"></div>`;

    const links = card.querySelector(".card-links");
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
