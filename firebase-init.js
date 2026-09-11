// =========================================================================
// Firebase 初期化・データアクセス層（Sparkプラン=無料枠のみで動く構成）
// Cloud Functionsは使わず、クライアントから直接Firestoreを読み書きする。
// 不正対策はFirestoreのセキュリティルール（firestore.rules）側で行う。
// =========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  increment,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAiIT5BvlhesWXlpN3h1MXCMawYRM3-58I",
  authDomain: "nagata-63e0d.firebaseapp.com",
  projectId: "nagata-63e0d",
  storageBucket: "nagata-63e0d.firebasestorage.app",
  messagingSenderId: "154962574427",
  appId: "1:154962574427:web:7cb9f661c6f604daec137e",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUid = null;
let resolveAuthReady;
const authReady = new Promise((res) => { resolveAuthReady = res; });

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUid = user.uid;
    resolveAuthReady(user.uid);
  }
});
signInAnonymously(auth).catch((err) => {
  console.error("匿名ログインに失敗しました", err);
});

function ensureSignedIn() {
  return authReady;
}

// users/{uid} を取得。無ければ初期値で作成して返す。
async function getUserData() {
  const uid = await ensureSignedIn();
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data();
    return {
      uid,
      displayName: d.display_name || "",
      semiconductorCount: d.semiconductor_count || 0,
    };
  }
  await setDoc(ref, {
    display_name: "",
    semiconductor_count: 0,
    created_at: serverTimestamp(),
  });
  return { uid, displayName: "", semiconductorCount: 0 };
}

// クリア結果を ranking_records に保存し、users の semiconductor_count を加算
// ドロップ判定はここ（クライアント側）で行う。Cloud Functionsがないため
// 100%不正防止はできないが、Firestoreのルール側でスコア・タイムの範囲、
// 1回あたりの加算上限をチェックして被害を限定する。
async function saveResult({ difficultyId, difficultyIndex, score, timeSec, dropAmount, displayName }) {
  const uid = currentUid || (await ensureSignedIn());

  await addDoc(collection(db, "ranking_records"), {
    user_id: uid,
    display_name: (displayName || "名無し").slice(0, 20) || "名無し",
    difficulty_id: difficultyId,
    difficulty_index: difficultyIndex,
    score,
    time_sec: timeSec,
    created_at: serverTimestamp(),
  });

  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      display_name: (displayName || "").slice(0, 20),
      semiconductor_count: increment(dropAmount || 0),
    },
    { merge: true }
  );
}

// ランキング一覧を取得（上位200件をscore降順で取得し、呼び出し側で最終ソート）
async function fetchRankings() {
  const q = query(collection(db, "ranking_records"), orderBy("score", "desc"), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

window.FirebaseAPI = { getUserData, saveResult, fetchRankings };
window.dispatchEvent(new Event("firebase-init-loaded"));
