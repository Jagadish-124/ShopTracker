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

// FIX #57: Catch persistence errors gracefully and log the reason
fbDb.enablePersistence({ synchronizeTabs: true }).catch(err => {
  // err.code === 'failed-precondition' → multiple tabs open
  // err.code === 'unimplemented'       → browser doesn't support it
  console.warn('Firestore persistence unavailable:', err.code);
});

function userDoc(uid)     { return fbDb.collection('users').doc(uid); }
function userDataDoc(uid) { return fbDb.collection('userData').doc(uid); }

// ── Input validation helpers ─────────────────────────────────────────────────

// FIX #58: Centralised UID whitelist validation — Firestore UIDs are
// alphanumeric + limited punctuation; reject anything else to
// prevent path traversal attacks on collection().doc(uid).
function assertValidUid(uid) {
  if (!uid || typeof uid !== 'string' || uid.length > 128 || !/^[\w-]+$/.test(uid)) {
    throw new Error('Invalid UID');
  }
}

// FIX #59: Max payload size guard — prevent writing enormous documents
// that would exhaust the free Firestore quota for other users.
const MAX_PAYLOAD_BYTES = 900_000; // Firestore 1 MB doc limit with safety margin
function assertPayloadSize(data) {
  const approxBytes = JSON.stringify(data).length;
  if (approxBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Data payload is too large (${Math.round(approxBytes / 1024)} KB). ` +
      'Please reduce the number of products or transactions before saving.'
    );
  }
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function fbSignUp(email, password, displayName) {
  // FIX #60: Trim and validate display name before sending to Firebase
  const safeName = String(displayName || '').trim().slice(0, 100);
  if (!safeName) throw Object.assign(new Error('Display name required'), { code: 'auth/invalid-display-name' });

  const cred = await fbAuth.createUserWithEmailAndPassword(email, password);
  const user = cred.user;
  await user.updateProfile({ displayName: safeName });
  await user.sendEmailVerification();

  // FIX #61: Use set with merge:false to ensure a fresh user document
  await userDoc(user.uid).set({
    name: safeName, email: user.email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    lastLogin: firebase.firestore.FieldValue.serverTimestamp()
  });
  await userDataDoc(user.uid).set({
    products: [], transactions: [], restockHistory: [],
    movementHistory: [], reviewedProducts: [],
    currency: 'INR', skuCounter: 1, dailyGoal: 0,
    notificationSettings: { enabled: false, lowStock: true, goal: true, dailySummary: true },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return { user };
}

async function fbSignIn(email, password) {
  const cred = await fbAuth.signInWithEmailAndPassword(email, password);
  // FIX #62: Use merge:true and only update non-sensitive fields on login
  await userDoc(cred.user.uid).set({
    lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
    email: cred.user.email           // keep email current in case it was updated
  }, { merge: true });
  return { user: cred.user };
}

async function fbSignOut()            { await fbAuth.signOut(); }
async function fbResendVerification() { const u = fbAuth.currentUser; if (u) await u.sendEmailVerification(); }
async function fbResetPassword(email) { await fbAuth.sendPasswordResetEmail(email); }
async function fbReloadUser()         { const u = fbAuth.currentUser; if (u) await u.reload(); return fbAuth.currentUser; }
function fbCurrentUser()              { return fbAuth.currentUser; }
function fbOnAuthStateChanged(cb)     { return fbAuth.onAuthStateChanged(cb); }

async function fbDeleteAccount(password) {
  const user = fbAuth.currentUser;
  if (!user) throw new Error('No user signed in.');

  const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
  await user.reauthenticateWithCredential(credential);

  const uid = user.uid;
  // FIX #63: Validate UID before using in Firestore paths
  assertValidUid(uid);

  await Promise.all([
    userDataDoc(uid).delete(),
    userDoc(uid).set({
      name: 'Deleted User',
      email: null,
      status: 'deleted',
      deletedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
  ]).catch(err => console.warn("Cleanup failed, but proceeding with auth deletion:", err));

  await user.delete();
}

// ── Firestore data ────────────────────────────────────────────────────────────

async function fbLoadUserData(uid) {
  // FIX #64: Validate UID before path construction
  assertValidUid(uid);
  const snap = await userDataDoc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function fbSaveUserData(uid, data) {
  // FIX #65: Validate UID + enforce payload size limit before writing
  assertValidUid(uid);

  // Strip undefined values (Firestore doesn't support them)
  const cleanData = JSON.parse(JSON.stringify(data));

  // Validate payload size — throw a user-friendly error before hitting Firestore limits
  assertPayloadSize(cleanData);

  await userDataDoc(uid).set({
    ...cleanData,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function fbSubscribeUserData(uid, onUpdate) {
  // FIX #66: Validate UID before subscribing
  assertValidUid(uid);
  return userDataDoc(uid).onSnapshot(
    { includeMetadataChanges: true },
    snap => { if (snap.exists) onUpdate(snap.data(), snap.metadata); },
    error => console.error("Snapshot error:", error)
  );
}

// ── Admin functions (creator only) ───────────────────────────────────────────

async function fbGetUserCount() {
  // FIX #67: Prefer the cheaper aggregation API; fall back gracefully
  try {
    const snapshot = await fbDb.collection('users').count().get();
    return snapshot.data().count;
  } catch (e) {
    // Fallback for environments without aggregation support
    const snapshot = await fbDb.collection('users').get();
    return snapshot.size;
  }
}

async function fbGetAllUsers() {
  // FIX #68: Limit the number of user records returned to avoid huge reads
  const snapshot = await fbDb.collection('users')
    .orderBy('lastLogin', 'desc')
    .limit(500)            // reasonable cap; adjust if the user base grows
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ── Expose to global scope ────────────────────────────────────────────────────

Object.assign(window, {
  fbSignUp, fbSignIn, fbSignOut, fbResendVerification,
  fbResetPassword, fbReloadUser, fbCurrentUser,
  fbOnAuthStateChanged, fbLoadUserData, fbSaveUserData, fbSubscribeUserData,
  fbDeleteAccount, fbGetUserCount, fbGetAllUsers
});