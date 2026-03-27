# Engagement Findings

- Session: ses_31b5d9c7fffexjK6aEP3B5A7cp
- Agent: pentest
- Started: 2026-03-13T00:44:32.501Z

## Findings

_Append each validated finding below with timestamp, asset, severity, confidence, evidence, impact, and remediation._
### [FND-H62MZFYVY9] Student chat history and identity data persist in localStorage after logout
- timestamp: 2026-03-13T00:44:32.511Z
- severity: medium
- confidence: 0.9
- asset: honorlyai.com /student-dashboard
- non_destructive: true

#### Evidence
The student dashboard stores per-class chat transcripts in browser localStorage under keys like `chat::<classCode>::<email>` and also reads `displayName` from localStorage. The auth flow stores `userEmail` and `displayName` in localStorage. Logout handlers for student, teacher, and admin sessions only call `localStorage.removeItem("role")`; they do not clear cached chat history, `userEmail`, or `displayName`.

#### Impact
On shared school devices or reused browser profiles, the previous user's identity metadata and cached chat content can remain on disk after logout. This creates avoidable FERPA/privacy exposure and increases the impact of any browser compromise or local account sharing.

#### Recommendation
Stop storing student chat transcripts in localStorage, or encrypt and expire them aggressively. On logout, clear all session-related keys including chat caches, `userEmail`, `displayName`, subscription state, and any role markers. Prefer server-backed state or sessionStorage for short-lived UI state.

#### Safe Reproduction Steps
1. Open the served source for `https://honorlyai.com/student-dashboard`.
2. Confirm `loadChatMessages()` / `saveChatMessages()` use localStorage keys of the form `chat::<classCode>::<email>`.
3. Confirm the logout handler only removes `role` before redirecting.
4. Review the auth page and confirm `userEmail` / `displayName` are written to localStorage during login/signup.

<!-- finding_json:{"id":"FND-H62MZFYVY9","title":"Student chat history and identity data persist in localStorage after logout","severity":"medium","confidence":0.9,"asset":"honorlyai.com /student-dashboard","evidence":"The student dashboard stores per-class chat transcripts in browser localStorage under keys like `chat::<classCode>::<email>` and also reads `displayName` from localStorage. The auth flow stores `userEmail` and `displayName` in localStorage. Logout handlers for student, teacher, and admin sessions only call `localStorage.removeItem(\"role\")`; they do not clear cached chat history, `userEmail`, or `displayName`.","impact":"On shared school devices or reused browser profiles, the previous user's identity metadata and cached chat content can remain on disk after logout. This creates avoidable FERPA/privacy exposure and increases the impact of any browser compromise or local account sharing.","recommendation":"Stop storing student chat transcripts in localStorage, or encrypt and expire them aggressively. On logout, clear all session-related keys including chat caches, `userEmail`, `displayName`, subscription state, and any role markers. Prefer server-backed state or sessionStorage for short-lived UI state.","safe_reproduction_steps":["Open the served source for `https://honorlyai.com/student-dashboard`.","Confirm `loadChatMessages()` / `saveChatMessages()` use localStorage keys of the form `chat::<classCode>::<email>`.","Confirm the logout handler only removes `role` before redirecting.","Review the auth page and confirm `userEmail` / `displayName` are written to localStorage during login/signup."],"non_destructive":true,"timestamp":"2026-03-13T00:44:32.511Z"} -->
### [FND-VSQFMP5EDQ] Email-based role approval can be bypassed through unverified self-service signup
- timestamp: 2026-03-13T00:44:32.501Z
- severity: high
- confidence: 0.92
- asset: honorlyai.com /auth
- non_destructive: true

#### Evidence
The public `/auth` page exposes self-service email/password signup (`createUserWithEmailAndPassword`) and then assigns privileged roles based only on the typed email string. Source review of the served page shows `isAllowedAdminEmail(email)` is called immediately after signup/login and sets `localStorage.role = "admin"` when the email matches an allowlisted Firestore document. The same flow sets `role = "teacher"` and calls `ensureTeacherDoc(...)` without any email verification gate. A search of the served auth code found no use of `sendEmailVerification`, `emailVerified`, or similar verification checks.

#### Impact
If a district/admin/teacher email address is allowlisted but not yet claimed in Firebase Auth, an attacker can register that email address with an arbitrary password and inherit teacher or admin access. In the admin case this can lead to school-level allowlist management and downstream student-data exposure.

#### Recommendation
Require verified Google SSO or enforce verified email ownership before any role lookup or privileged session bootstrap. Do not trust the raw email string at signup time. Gate admin/teacher elevation on server-side checks against `user.emailVerified` or IdP claims, and consider disabling email/password signup for privileged roles entirely.

#### Safe Reproduction Steps
1. Open `https://honorlyai.com/auth` and inspect the served auth source.
2. Confirm the page offers public email/password signup and login.
3. Review the signup/login handlers showing `createUserWithEmailAndPassword` / `signInWithEmailAndPassword` followed by `isAllowedAdminEmail(email)` / teacher role assignment.
4. Confirm there is no email-verification check before role elevation.

<!-- finding_json:{"id":"FND-VSQFMP5EDQ","title":"Email-based role approval can be bypassed through unverified self-service signup","severity":"high","confidence":0.92,"asset":"honorlyai.com /auth","evidence":"The public `/auth` page exposes self-service email/password signup (`createUserWithEmailAndPassword`) and then assigns privileged roles based only on the typed email string. Source review of the served page shows `isAllowedAdminEmail(email)` is called immediately after signup/login and sets `localStorage.role = \"admin\"` when the email matches an allowlisted Firestore document. The same flow sets `role = \"teacher\"` and calls `ensureTeacherDoc(...)` without any email verification gate. A search of the served auth code found no use of `sendEmailVerification`, `emailVerified`, or similar verification checks.","impact":"If a district/admin/teacher email address is allowlisted but not yet claimed in Firebase Auth, an attacker can register that email address with an arbitrary password and inherit teacher or admin access. In the admin case this can lead to school-level allowlist management and downstream student-data exposure.","recommendation":"Require verified Google SSO or enforce verified email ownership before any role lookup or privileged session bootstrap. Do not trust the raw email string at signup time. Gate admin/teacher elevation on server-side checks against `user.emailVerified` or IdP claims, and consider disabling email/password signup for privileged roles entirely.","safe_reproduction_steps":["Open `https://honorlyai.com/auth` and inspect the served auth source.","Confirm the page offers public email/password signup and login.","Review the signup/login handlers showing `createUserWithEmailAndPassword` / `signInWithEmailAndPassword` followed by `isAllowedAdminEmail(email)` / teacher role assignment.","Confirm there is no email-verification check before role elevation."],"non_destructive":true,"timestamp":"2026-03-13T00:44:32.501Z"} -->
### [FND-FNMAPXF8JY] Teacher approval revocation is not enforced when loading the teacher dashboard
- timestamp: 2026-03-13T00:44:32.506Z
- severity: medium
- confidence: 0.87
- asset: honorlyai.com /teacher-dashboard
- non_destructive: true

#### Evidence
The served `teacher-dashboard` code defines `requireApprovedTeacher()` which checks `teachers/{uid}` and `allowedTeachers/{email}` for `approved === true`, but the page initialization path does not call it. In `onAuthStateChanged(...)`, the code sets `currentUser`, hydrates profile info, and immediately runs `loadClassesFromFirestore()` and `renderStudentList()` without revalidating teacher approval. Those data-loading functions query Firestore using `currentUser.uid`, enabling previously created teacher-owned data to remain accessible after approval is revoked.

#### Impact
A teacher account that has been removed from the allowlist or marked unapproved may still retain access to its previously created classes, enrollments, and student chat history until deeper rules block it. That undermines offboarding and can leave revoked users with ongoing visibility into student records.

#### Recommendation
Enforce `requireApprovedTeacher()` at the top of the teacher dashboard bootstrap before any data load, listener, or UI hydration. Mirror the same approval check in backend/Firestore rules so revocation is enforced even if the client is modified.

#### Safe Reproduction Steps
1. Open `https://honorlyai.com/teacher-dashboard` source.
2. Review `requireApprovedTeacher()` and note its approval checks.
3. Review the `onAuthStateChanged(...)` bootstrap path and confirm it does not call `requireApprovedTeacher()` before loading classes/student data.
4. Compare this with `createClass()`, which does call `requireApprovedTeacher()`, showing the inconsistency.

<!-- finding_json:{"id":"FND-FNMAPXF8JY","title":"Teacher approval revocation is not enforced when loading the teacher dashboard","severity":"medium","confidence":0.87,"asset":"honorlyai.com /teacher-dashboard","evidence":"The served `teacher-dashboard` code defines `requireApprovedTeacher()` which checks `teachers/{uid}` and `allowedTeachers/{email}` for `approved === true`, but the page initialization path does not call it. In `onAuthStateChanged(...)`, the code sets `currentUser`, hydrates profile info, and immediately runs `loadClassesFromFirestore()` and `renderStudentList()` without revalidating teacher approval. Those data-loading functions query Firestore using `currentUser.uid`, enabling previously created teacher-owned data to remain accessible after approval is revoked.","impact":"A teacher account that has been removed from the allowlist or marked unapproved may still retain access to its previously created classes, enrollments, and student chat history until deeper rules block it. That undermines offboarding and can leave revoked users with ongoing visibility into student records.","recommendation":"Enforce `requireApprovedTeacher()` at the top of the teacher dashboard bootstrap before any data load, listener, or UI hydration. Mirror the same approval check in backend/Firestore rules so revocation is enforced even if the client is modified.","safe_reproduction_steps":["Open `https://honorlyai.com/teacher-dashboard` source.","Review `requireApprovedTeacher()` and note its approval checks.","Review the `onAuthStateChanged(...)` bootstrap path and confirm it does not call `requireApprovedTeacher()` before loading classes/student data.","Compare this with `createClass()`, which does call `requireApprovedTeacher()`, showing the inconsistency."],"non_destructive":true,"timestamp":"2026-03-13T00:44:32.506Z"} -->
