// ============================================================================
// firebase.js  —  Firebase Auth + Firestore for Shop Tracker
// Firebase v9 compat CDN — no bundler needed.
// ============================================================================

const firebaseConfig = {
  apiKey:            "AIzaSyBoJB8XfdS2hIJdBFiIa1jD-ohSGKVewsA",
  authDomain:        "shop-tracker-7b6fd.firebaseapp.com",
  projectId:         "shop-tracker-7b6fd",
  storageBucket:     "shop-tracker-7b6fd.firebasestorage.app",
  messagingSenderId: "250701408991",
  appId:             "1:250701408991:web:bf664d5879eb528da4976a",
  measurementId:     "G-DJ8165SBRH"
};

firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbDb   = firebase.firestore();

fbDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});

function userDoc(uid)     { return fbDb.collection('users').doc(uid); }
function userDataDoc(uid) { return fbDb.collection('userData').doc(uid); }

// ── Auth ─────────────────────────────────────────────────────────────────────

async function fbSignUp(email, password, displayName) {
  const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
  const user = cred.user;
  await user.updateProfile({ displayName });
  await user.sendEmailVerification();
  await userDoc(user.uid).set({
    name: displayName, email: user.email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await userDataDoc(user.uid).set({
    products: [], transactions: [], restockHistory: [],
    movementHistory: [], reviewedProducts: [],
    currency: 'INR', skuCounter: 1, dailyGoal: 0,
    notificationSettings: { enabled: false, lowStock: true, goal: true },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return { user };
}

async function fbSignIn(email, password) {
  const cred = await fbAuth.signInWithEmailAndPassword(email, password);
  return { user: cred.user };
}

async function fbSignOut()            { await fbAuth.signOut(); }
async function fbResendVerification() { const u = fbAuth.currentUser; if (u) await u.sendEmailVerification(); }
async function fbResetPassword(email) { await fbAuth.sendPasswordResetEmail(email); }
async function fbReloadUser()         { const u = fbAuth.currentUser; if (u) await u.reload(); return fbAuth.currentUser; }
function fbCurrentUser()              { return fbAuth.currentUser; }
function fbOnAuthStateChanged(cb)     { return fbAuth.onAuthStateChanged(cb); }

// ── Firestore data ────────────────────────────────────────────────────────────

async function fbLoadUserData(uid) {
  const snap = await userDataDoc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function fbSaveUserData(uid, data) {
  await userDataDoc(uid).set({ ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
}

function fbSubscribeUserData(uid, onUpdate) {
  return userDataDoc(uid).onSnapshot(snap => { if (snap.exists) onUpdate(snap.data()); });
}

Object.assign(window, {
  fbSignUp, fbSignIn, fbSignOut, fbResendVerification,
  fbResetPassword, fbReloadUser, fbCurrentUser,
  fbOnAuthStateChanged, fbLoadUserData, fbSaveUserData, fbSubscribeUserData
});