/**
 * map.js — Leaflet 地図: 自宅マーカー・同心円(2/5/10/20km)・施設ピン
 */
"use strict";

const MapView = (() => {
  const RADII = [2, 5, 10, 20, 30, 40, 50];
  const STAR_COLORS = { 5: "#1a6b54", 4: "#4c9c62", 3: "#e8a013", 2: "#d9822b", 1: "#b3472f", null: "#888" };

  let map, homeMarker, circleLayer, pinLayer;
  let onPinClick = null;
  let curCenter = null;
  let band = { min: 0, max: 2 };  // 選択中の距離帯（強調表示用）

  function init(center) {
    map = L.map("map").setView([center.lat, center.lon], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);
    circleLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);
    drawHome(center);
  }

  function drawHome(center) {
    curCenter = center;
    if (homeMarker) map.removeLayer(homeMarker);
    homeMarker = L.marker([center.lat, center.lon], {
      title: "自宅",
      zIndexOffset: 1000,
    }).addTo(map).bindPopup("📍 自宅（" + (center.label || "検索地点") + "）");
    drawCircles(center);
  }

  /** 選択中の距離帯（bandMin〜bandMax）の境界円を強調する */
  function setBand(min, max) {
    band = { min, max };
    if (curCenter) drawCircles(curCenter);
  }

  function drawCircles(center) {
    circleLayer.clearLayers();
    for (const r of RADII) {
      const isBoundary = r === band.max || (band.min > 0 && r === band.min);
      L.circle([center.lat, center.lon], {
        radius: r * 1000,
        color: isBoundary ? "#d9822b" : "#1a6b54",
        weight: isBoundary ? 3 : 1,
        opacity: isBoundary ? 0.9 : 0.4,
        fillOpacity: 0.02,
        interactive: false,
      }).addTo(circleLayer);
      // 距離ラベル（円の真上端）
      const labelLat = center.lat + r / 111.0;
      L.marker([labelLat, center.lon], {
        interactive: false,
        icon: L.divIcon({
          className: "radius-label",
          html: `<span style="background:rgba(255,255,255,.85);padding:1px 6px;border-radius:6px;font-size:12px;color:#1a6b54;border:1px solid #1a6b54;">${r}km</span>`,
          iconSize: [44, 18],
          iconAnchor: [22, 9],
        }),
      }).addTo(circleLayer);
    }
  }

  /** 施設ピンを描き直す。facilities は evaluate 済み（f._eval あり）前提 */
  function updatePins(facilities) {
    pinLayer.clearLayers();
    for (const f of facilities) {
      const stars = Score.toStars(f._eval.total);
      const marker = L.circleMarker([f.lat, f.lon], {
        radius: 8,
        color: "#fff",
        weight: 1.5,
        fillColor: STAR_COLORS[stars],
        fillOpacity: 0.9,
      }).addTo(pinLayer);
      const trainTxt = f._eval.train ? `🚃約${f._eval.train.minutes}分` : "🚃 −";
      marker.bindPopup(
        `<div class="popup-name">${escapeHtml(f.name)}</div>` +
        `${Score.starLabel(stars)}<br>` +
        `🚗約${f._eval.carMin}分 ${trainTxt}（${f._eval.distanceKm}km）<br>` +
        `<a href="${f.kouhyou_url}" target="_blank" rel="noopener">公表システムで詳細を見る</a>`
      );
      marker.on("click", () => { if (onPinClick) onPinClick(f.id); });
    }
  }

  function fitToRadius(center, radiusKm) {
    const dLat = radiusKm / 111.0;
    const dLon = radiusKm / (111.0 * Math.cos(center.lat * Math.PI / 180));
    map.fitBounds([
      [center.lat - dLat, center.lon - dLon],
      [center.lat + dLat, center.lon + dLon],
    ]);
  }

  function setPinClickHandler(fn) { onPinClick = fn; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  return { init, drawHome, updatePins, fitToRadius, setBand, setPinClickHandler, escapeHtml };
})();
