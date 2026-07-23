/**
 * score.js — 評価スコア算出（設計書 2.3 準拠）
 * S1a(車)・S1b(電車)・総合はここでクライアント動的算出。
 * S2/S3/S4 はバッチ算出値（facilities.js）を使用。
 * 算出式は about.html（評価基準ページ）で全公開する。
 */
"use strict";

const Score = (() => {
  // 総合の重み（通い方トグルで切替: FR-02-4）
  const WEIGHTS = {
    both:  { s1a: 15, s1b: 15, s2: 20, s3: 30, s4: 20 },
    car:   { s1a: 30, s1b: 0,  s2: 20, s3: 30, s4: 20 },
    train: { s1a: 0,  s1b: 30, s2: 20, s3: 30, s4: 20 },
  };

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** 🚗 車の所要時間目安（分）: 直線距離×道路係数1.4 ÷ 30km/h */
  function carMinutes(distKm) {
    return Math.max(1, Math.round((distKm * 1.4) / 30 * 60));
  }

  /** S1a: 0分=100点 〜 60分=0点 */
  function carScore(distKm) {
    const m = carMinutes(distKm);
    return Math.max(0, Math.round(100 - Math.min(m, 60) / 60 * 100));
  }

  /**
   * 🚃 電車: 自宅最寄駅 →(乗車近似)→ 施設最寄駅 →(徒歩)→ 施設
   * 乗車近似 = 駅間直線距離 ÷ 表定速度30km/h + 乗継バッファ10分
   * 戻り値: { minutes, walkMin, rideMin, score } / 駅データ欠損時 null
   */
  function trainInfo(facility, homeStation) {
    const st = facility.nearest_station;
    if (!st || !homeStation) return null;
    const stationDistKm = haversineKm(homeStation.lat, homeStation.lon, st.lat, st.lon);
    const rideMin = Math.round(stationDistKm / 30 * 60) + 10;
    const minutes = rideMin + st.walk_min;
    // 駅近さ60点（徒歩5分以内=満点〜30分=0）+ 自宅側アクセス40点（15分以内=満点〜60分=0）
    const walkPart = 60 * clamp01(1 - (st.walk_min - 5) / 25);
    const ridePart = 40 * clamp01(1 - (rideMin - 15) / 45);
    return { minutes, walkMin: st.walk_min, rideMin, score: Math.round(walkPart + ridePart) };
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /** 総合: 有効指標の加重平均（欠損指標は重み再配分: FR-02-3） */
  function totalScore(parts, mode) {
    const w = WEIGHTS[mode] || WEIGHTS.both;
    let sum = 0, wsum = 0;
    for (const key of ["s1a", "s1b", "s2", "s3", "s4"]) {
      if (parts[key] !== null && parts[key] !== undefined && w[key] > 0) {
        sum += parts[key] * w[key];
        wsum += w[key];
      }
    }
    return wsum > 0 ? Math.round(sum / wsum) : null;
  }

  /** 100点満点 → ★1〜5（90/70/50/30 境界） */
  function toStars(score) {
    if (score === null || score === undefined) return null;
    if (score >= 90) return 5;
    if (score >= 70) return 4;
    if (score >= 50) return 3;
    if (score >= 30) return 2;
    return 1;
  }

  function starLabel(stars) {
    return stars === null ? "評価なし" : "★".repeat(stars) + "☆".repeat(5 - stars);
  }

  /**
   * 施設1件の全スコアを算出して付与する
   * @param {object} f 施設
   * @param {{lat,lon}} home 自宅座標
   * @param {object|null} homeStation 自宅最寄駅
   * @param {string} mode car|train|both
   */
  function evaluate(f, home, homeStation, mode) {
    const d = haversineKm(home.lat, home.lon, f.lat, f.lon);
    const train = trainInfo(f, homeStation);
    const parts = {
      s1a: carScore(d),
      s1b: train ? train.score : null,
      s2: f.scores ? f.scores.s2_size : null,
      s3: f.scores ? f.scores.s3_quality : null,
      s4: f.scores ? f.scores.s4_years : null,
    };
    return {
      distanceKm: Math.round(d * 100) / 100,
      carMin: carMinutes(d),
      train,
      parts,
      total: totalScore(parts, mode),
    };
  }

  /** 自宅最寄駅の近似: 全施設の最寄駅集合から自宅に最も近い駅を選ぶ */
  function findHomeStation(facilities, home) {
    let best = null, bestD = Infinity;
    const seen = new Set();
    for (const f of facilities) {
      const st = f.nearest_station;
      if (!st || seen.has(st.name + st.line)) continue;
      seen.add(st.name + st.line);
      const d = haversineKm(home.lat, home.lon, st.lat, st.lon);
      if (d < bestD) { bestD = d; best = st; }
    }
    return best;
  }

  return { evaluate, findHomeStation, toStars, starLabel, haversineKm, WEIGHTS };
})();
