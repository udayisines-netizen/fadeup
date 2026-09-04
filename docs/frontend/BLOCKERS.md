# Blocages infra constatés en P1b (2026-09-04)

Deux blocages hors périmètre frontend, constatés et vérifiés pendant P1b.
Ils ne sont PAS contournables côté code applicatif ; les écrans concernés
sont livrés et affichent des erreurs traduites en attendant.

---

## 1. Envoi d'e-mails GoTrue — **BLOQUANT POUR P2**

**Symptôme.** Tout envoi d'e-mail d'authentification échoue : lien magique
(`POST /auth/v1/otp`), réinitialisation de mot de passe
(`resetPasswordForEmail`). GoTrue répond `500 unexpected_failure`
(« Error sending magic link email »).

**Cause exacte** (logs `fadeup-supabase-auth`, test de bout en bout du
2026-09-04) :

```
dial tcp: lookup supabase-mail on 127.0.0.11:53: server misbehaving
```

`infra/supabase/.env` pointe `SMTP_HOST=supabase-mail` / `SMTP_PORT=2500` —
**le conteneur `supabase-mail` n'existe pas** (absent de `docker ps`). C'est
le serveur de test du stack Supabase par défaut, jamais déployé ici. De
plus `SMTP_SENDER_NAME=fake_sender` : même en relançant ce conteneur, ce
serait une boîte de test, pas une délivrance réelle.

**Ce qui fonctionne malgré tout.** `ENABLE_EMAIL_AUTOCONFIRM=true` :
inscription, connexion et déconnexion par mot de passe fonctionnent sans
e-mail (vérifié e2e). Les écrans `/auth/magic`, `/auth/otp`, `/auth/forgot`
sont construits, testés, et remontent l'échec TRADUIT
(`v2:auth.errors.emailSendFailed`), jamais le texte brut.

**Impact.** L'inscription ultra-légère dans le flux de réservation
(lien magique / OTP — exigence P2) n'a AUCUN canal d'envoi. **P2 est bloqué
tant que ce point n'est pas réparé.**

**Remédiation** (infra, décision fondateur pour le fournisseur) :
1. Provisionner un vrai fournisseur SMTP (ou, pour le dev local, déployer
   un conteneur Mailpit/Inbucket et le nommer `supabase-mail` sur le réseau
   du compose Supabase).
2. Renseigner `SMTP_HOST/PORT/USER/PASS/SMTP_SENDER_NAME/SMTP_ADMIN_EMAIL`
   avec des valeurs réelles dans `infra/supabase/.env`, puis recréer le
   conteneur `fadeup-supabase-auth`.
3. Ajouter les hôtes de dev à `GOTRUE_MAILER_EXTERNAL_HOSTS` (GoTrue ignore
   aujourd'hui les `Host`/`X-Forwarded-Host` locaux — avertissement dans
   les logs) et vérifier `SITE_URL`/`ADDITIONAL_REDIRECT_URLS`
   (actuellement `https://fade-up.com` uniquement : les liens des e-mails
   ne reviendront jamais vers un environnement local).
4. Re-vérifier de bout en bout : `POST /auth/v1/otp` → 200, e-mail reçu,
   lien → `/auth/callback` → session ; code à 6 chiffres → `/auth/otp`.

---

## 2. E2E WebKit — non exécutable sur cet hôte

**Symptôme.** `playwright install webkit` télécharge le binaire
(`~/.cache/ms-playwright/webkit-2336`) mais tout lancement échoue :
« Host system is missing dependencies to run browsers ».

**Cause exacte.** Bibliothèques système absentes : `libgtk-4`,
`libgraphene`, `libevent-2.1`, la pile GStreamer (`libgstallocators`,
`libgstapp`, `libgstaudio`, `libgstvideo`, `libgstgl`, …), `libflite` et
ses voix, entre autres. Leur installation (`npx playwright install-deps
webkit` ou apt) **exige root**, indisponible pour l'utilisateur `fadeup`
(`sudo` refusé).

**État livré.** `playwright.config.ts` définit les quatre projets ; les
deux projets WebKit (390 px et 1440 px) sont conditionnés à
`P1B_WEBKIT=1` pour que `npm run e2e` reste déterministe sur cet hôte.
Chromium 390/1440 couvre aujourd'hui les 39 scénarios.

**Remédiation.**
1. Avec un accès root : `sudo npx playwright install-deps webkit`
   (ou installer la liste apt équivalente), une seule fois par hôte.
2. Puis : `P1B_WEBKIT=1 npm run e2e` — les specs existantes tournent
   telles quelles sur les quatre projets ; aucune modification de code
   n'est nécessaire.
