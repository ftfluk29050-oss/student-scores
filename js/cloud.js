/* เชื่อมต่อ Firebase: ล็อกอินด้วยอีเมล/รหัสผ่าน และเก็บข้อมูลใน Firestore
   โครงสร้างข้อมูล (ทุกอย่างอยู่ใต้บัญชีของผู้ใช้ มีแต่เจ้าของบัญชีที่อ่าน/เขียนได้ตาม Rules)
     users/{uid}/data/main        {subjects, notes, lastBackup}
     users/{uid}/scores/{วิชา}     {s: {รหัสนักเรียน: {ช่องคะแนน: คะแนน}}}
     users/{uid}/photos/{รหัสนักเรียน} {data: รูปแบบ data URL} */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut as fbSignOut, sendPasswordResetEmail }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, setDoc, deleteDoc,
  onSnapshot, getDocFromServer, getDocsFromServer, deleteField, query, limit }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let auth, fs, uid = null, unsub = [], h;

const mainRef = () => doc(fs, 'users', uid, 'data', 'main');
const scoresRef = (sid) => doc(fs, 'users', uid, 'scores', sid);
const photoRef = (code) => doc(fs, 'users', uid, 'photos', String(code));
const col = (name) => collection(fs, 'users', uid, name);

export function init(config, handlers) {
  h = handlers;
  const app = initializeApp(config);
  auth = getAuth(app);
  try {
    // เก็บสำเนาในเครื่อง ทำให้เปิดใช้และกรอกคะแนนตอนออฟไลน์ได้ แล้วซิงก์เมื่อมีอินเทอร์เน็ต
    fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    fs = getFirestore(app);
  }
  onAuthStateChanged(auth, (user) => {
    unsub.forEach((f) => f()); unsub = [];
    uid = user ? user.uid : null;
    h.auth(user ? { uid: user.uid, email: user.email } : null);
    if (user) listen();
  });
}

function listen() {
  const got = { m: false, s: false, p: false };
  let ready = false;
  const mark = (k) => { got[k] = true; if (!ready && got.m && got.s && got.p) { ready = true; h.ready(); } };
  const fail = (e) => h.error((e && e.code) || 'error');
  unsub.push(onSnapshot(mainRef(), (snap) => {
    h.main(snap.exists() ? snap.data() : null, snap.metadata.hasPendingWrites); mark('m');
  }, fail));
  unsub.push(onSnapshot(col('scores'), (snap) => {
    snap.docChanges().forEach((c) => h.scores(c.doc.id, c.type === 'removed' ? null : (c.doc.data().s || {}), c.doc.metadata.hasPendingWrites));
    mark('s');
  }, fail));
  unsub.push(onSnapshot(col('photos'), (snap) => {
    snap.docChanges().forEach((c) => h.photo(c.doc.id, c.type === 'removed' ? null : (c.doc.data().data || null), c.doc.metadata.hasPendingWrites));
    mark('p');
  }, fail));
}

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const signOut = () => fbSignOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

// ถามเซิร์ฟเวอร์โดยตรงว่าบัญชีนี้มีข้อมูลอยู่แล้วหรือยัง (ใช้ตอนย้ายข้อมูลจากเครื่องขึ้นคลาวด์ครั้งแรก)
export async function remoteHasData() {
  const m = await getDocFromServer(mainRef());
  if (m.exists()) {
    const d = m.data();
    if ((d.subjects || []).length || Object.keys(d.notes || {}).length) return true;
  }
  const p = await getDocsFromServer(query(col('photos'), limit(1)));
  return !p.empty;
}

export const putMain = (obj) => setDoc(mainRef(), obj);
export const putScores = (sid, map) => setDoc(scoresRef(sid), { s: map });
export const delScores = (sid) => deleteDoc(scoresRef(sid));
export const putPhoto = (code, data) => setDoc(photoRef(code), { data });
export const delPhoto = (code) => deleteDoc(photoRef(code));

// แก้เฉพาะช่องที่เปลี่ยน: patch = {รหัสนักเรียน: {ช่องคะแนน: คะแนน หรือ null เพื่อลบ}}
export function patchScores(sid, patch) {
  const s = {};
  Object.keys(patch).forEach((code) => {
    s[code] = {};
    Object.keys(patch[code]).forEach((iid) => { s[code][iid] = patch[code][iid] === null ? deleteField() : patch[code][iid]; });
  });
  return setDoc(scoresRef(sid), { s }, { merge: true });
}
