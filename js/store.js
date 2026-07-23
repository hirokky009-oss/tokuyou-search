/**
 * store.js — チェック・メモの保存層
 *
 * Firebase設定（window.FIREBASE_CONFIG）があれば Firestore で全端末共有＋リアルタイム同期。
 * なければ localStorage（端末内）にフォールバック。
 * 上位（app.js）は MarkStore.get/set/init だけを使い、保存先を意識しない。
 *
 * データ構造: Firestore の marks/shared ドキュメントに、施設IDをキーとした
 *   { "<id>": { mark: "fav"|"ng"|null, memo: "..." } } を1ドキュメントで保持（読み書きが安価）。
 */
"use strict";

const MarkStore = (() => {
  const LS_KEY = "tokuyou_marks";
  let cache = {};
  let onChange = null;   // リモート更新時に app.js へ再描画を促すコールバック
  let mode = "local";    // local | firebase
  let db = null;
  let docRef = null;
  let writing = false;   // 自分の書き込みエコーで無限ループしないためのフラグ

  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cache));
    } catch (e) { /* プライベートブラウズ等では保存不可。動作は継続 */ }
  }

  /** 初期化。onRemoteChange はリモート更新があったとき呼ばれる（Firebase時のみ） */
  function init(onRemoteChange) {
    onChange = onRemoteChange;
    cache = loadLocal();  // まずローカル値で即描画できるように

    const cfg = window.FIREBASE_CONFIG;
    if (cfg && window.firebase && firebase.firestore) {
      try {
        firebase.initializeApp(cfg);
        db = firebase.firestore();
        docRef = db.collection("marks").doc("shared");
        mode = "firebase";
        // リアルタイム購読: 他端末の変更が即反映される
        docRef.onSnapshot((snap) => {
          if (writing) return;               // 自分の書き込みは無視
          const remote = (snap.exists && snap.data()) || {};
          cache = remote;
          saveLocal();                        // オフライン時のキャッシュも兼ねる
          if (onChange) onChange();
        }, (err) => {
          console.warn("Firestore購読エラー。ローカル保存に切替:", err);
          mode = "local";
        });
      } catch (e) {
        console.warn("Firebase初期化失敗。ローカル保存で継続:", e);
        mode = "local";
      }
    }
  }

  function get(id) {
    return cache[id] || { mark: null, memo: "" };
  }

  function set(id, patch) {
    const next = Object.assign(get(id), patch);
    if (!next.mark && !next.memo) {
      delete cache[id];
    } else {
      cache[id] = next;
    }
    saveLocal();
    if (mode === "firebase" && docRef) {
      writing = true;
      docRef.set(cache)
        .catch((e) => console.warn("Firestore保存失敗（ローカルには保存済み）:", e))
        .finally(() => { setTimeout(() => { writing = false; }, 300); });
    }
  }

  function all() {
    return cache;
  }

  function isShared() {
    return mode === "firebase";
  }

  return { init, get, set, all, isShared };
})();
