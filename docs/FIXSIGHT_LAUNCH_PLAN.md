# FixSight launch plan — fixsight.contractor-office.com

Prepared 2026-11-21. Nothing in this plan has been executed: no push, no deploy, no settings changed.

## Where things stand (checked read-only)

- **The address already works.** `fixsight.contractor-office.com` is a DNS-only CNAME in your Cloudflare zone pointing to Vercel, attached and verified as the production domain of Vercel project **`fixsight`** (team "chrisbowling220-6638's projects"). **No DNS change is needed.** The rest of contractor-office.com stays on Firebase and is unaffected.
- **What's live there now is the old app** from `main` (prompt v4). It has working Anthropic and ElevenLabs keys and **no access code**, so anyone who finds the URL can run paid analyses.
- Vercel preview deployments and `*.vercel.app` addresses require a Vercel login; the custom domain is public.
- The release candidate is on branch `claude/fixsight-release-candidate`, committed and clean. `main` is unchanged.

## Deployment approach (safest and simplest)

Use the existing Vercel project and its GitHub integration; don't create new hosting:

push branch → protected preview (free demo mode) → phone test → set production settings → merge to `main` → live at the domain. Rollback is one click in Vercel.

This branch is already adapted to Vercel's limits: security headers on the static pages, a 180-second function time limit with Fluid compute, and photos automatically re-encoded smaller for sending so requests stay under Vercel's 4.5 MB request limit.

## Production settings to enter (Vercel → fixsight → Settings → Environment Variables)

**Production environment**

| Variable | Value | Why |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | keep the existing one | AI analysis |
| `FIXSIGHT_ACCESS_CODE` | a long passphrase you choose (e.g. four random words) | Blocks anonymous paid use; you enter it once per device |
| `TRUST_PROXY` | `true` | Rate limits apply per visitor instead of to Vercel's shared proxy address |
| `ANALYSIS_DAILY_CAP` | `40` | Runaway backstop per server instance (the provider spend limit is the hard cap) |
| `ELEVENLABS_API_KEY` | keep, or delete to turn premium voice off | The app's default read-aloud voice is the free device voice |

Leave `RATE_LIMIT_MAX` at its default (20 analyses per 15 minutes per visitor). **Never set `FIXSIGHT_DEMO_MODE` in Production.**

**Preview environment** (branch `claude/fixsight-release-candidate` only): `FIXSIGHT_DEMO_MODE` = `true` (free testing, no AI calls).

**Provider accounts (hard spending caps):**
- Anthropic Console → Settings → Limits: set a monthly spend limit (for example $50) and an email alert.
- ElevenLabs: your plan's character quota is the cap; keep it low or remove the key.

## Preview status (2026-11-21)

- Branch pushed; protected preview live at `https://fixsight-git-claude-fixsi-36c581-chrisbowling220-6638s-projects.vercel.app` (requires Vercel login). `main` and production unchanged.
- Every non-production Vercel deployment is locked to demo mode by the code itself (no provider keys loaded), whatever the Preview environment variables contain. `/api/health` on the preview shows `"environment":"preview","demo_mode":true,"paid_providers_enabled":false`, so step 2 below is no longer needed.
- Verified on the live preview with phone (Chrome), iPad (WebKit), and desktop (Chrome) profiles: navigation, photos, sample diagnosis with questions, customer/job, inspection and job PDFs, service worker, security headers.

## Exact steps

1. **You approve, then I run:** `git push -u origin claude/fixsight-release-candidate`. Vercel builds a preview automatically (about 2 minutes).
2. In Vercel, add the Preview variable `FIXSIGHT_DEMO_MODE=true` for that branch, then **Redeploy** the preview.
3. On your phone, sign in at vercel.com in the browser (previews are protected), open the preview link from the Vercel dashboard, and run **checklist A** below.
4. Enter the Production settings above and set the Anthropic spend limit.
5. On GitHub, open a pull request from `claude/fixsight-release-candidate` to `main` and merge it. Vercel deploys to production; the domain switches to the new app within a couple of minutes.
6. Open `https://fixsight.contractor-office.com/api/health`. It must show `"prompt_version":"prompt_v5"`, `"environment":"production"`, `"access_code_required":true`, `"demo_mode":false`, `"paid_providers_enabled":true`.
7. On each device (phone, tablet, computer): open the site → Settings → enter the access code → install it (below) → run **checklist B**.

## Real-device checklist

**A. Preview, demo mode (free)** — on iPhone (Safari), Android (Chrome), and iPad/tablet:
1. The page loads, with the yellow "Demo mode" banner and an "Online" status.
2. **Take photo** opens the rear camera; take one photo. **From library** opens your photos; add a second.
3. Tap **Mark problem**, circle something with your finger, and save. The tile now says "Edit marks".
4. Tap the 🎤 button, allow the microphone, and say a sentence; the words appear in the box.
5. Type "ceiling stain", tap **Analyze photos**, answer the questions, and a full result appears.
6. Tick a repair step, close the browser, reopen; the tick is still there.
7. **Download PDF report** opens or saves a readable 2-page PDF. **Share summary** offers your share sheet.
8. Tap **🔊 Read aloud**; you hear the result. **Hands-free repair steps** → Next/Back work.
9. Tablet: rotate it; the side menu and two-column layout look right.

**B. Production (one real analysis, about $0.10–$0.30)**
1. Without the access code, Analyze shows "This server needs an access code"; enter it in Settings and analysis works.
2. Photograph a real problem and check that the result's observations match what's actually in the photo.
3. Install: iPhone/iPad → Share → **Add to Home Screen**; Android → ⋮ → **Install app**. Open it from the home-screen icon.
4. Turn on airplane mode, open the installed app, and open a saved inspection (it loads). Make a draft; turn the network back on and analyze it.
5. Settings → **Export backup** saves a file.

Note any failure with the device model and step number.

## Costs

| Item | Cost |
| --- | --- |
| Domain and Cloudflare DNS | Already in place; no change |
| Vercel hosting | Your current plan. If it's the free Hobby plan, check Vercel's terms for business use; Pro is $20/month per member. |
| AI analysis (Anthropic, `claude-opus-5`) | Estimated $0.10–$0.30 per analysis; a follow-up-question round roughly doubles it. Example: 5 analyses a day ≈ $15–$45/month. Not yet measured on real photos. |
| Premium voice (ElevenLabs) | Only if used; the free device voice is the default. |
| Everything else (PDFs, storage, offline) | Free; runs on the device |

## Your approvals needed

1. Push the branch (creates the protected preview).
2. Enter the Production variables, especially `FIXSIGHT_ACCESS_CODE` and `TRUST_PROXY`.
3. Merge to `main` (goes live at the domain).
4. Set the Anthropic spend limit.
5. Later and optional: a ~$10 evaluation run with real photos to confirm accuracy and decide whether to switch to the cheaper `claude-opus-5-5`.

## Rollback

- **Before step 5,** production is untouched.
- **After merging:** Vercel → fixsight → Deployments → choose the previous production deployment (`fixsight-8huq188fi-…`, the current live one) → **Instant Rollback**. The domain returns to the old app in seconds. To make it permanent, revert the merge commit on GitHub.
- Environment variables can be removed at any time; changes take effect on the next deployment.
- **Data:** inspections live on each device. On first open, the new app copies the old app's saved scans and leaves the originals in place, so rolling back still shows the pre-upgrade history.
- The Codex work is preserved on `codex/fixsight-full-upgrade-wip-snapshot`; nothing was deleted.

## Daily-use notes

- Each device keeps its own inspections; the phone and computer don't sync. To move them, use Settings → Export backup / Import backup.
- On iPhone/iPad, install FixSight to the Home Screen; Safari may clear data for websites unused for 7 days.
- The Expo mobile app is not part of this launch (it would also need smaller photo uploads for Vercel's size limit). Use the website on phones and tablets.
