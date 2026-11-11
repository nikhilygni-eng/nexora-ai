# Official rules → NEXORA status

Checked against the PayPal AI Hackathon Official Rules (sections 1–4) on 2026-11-11.
**Deadline: Thu Nov 12, 12:00 pm Pacific = Fri Nov 13, 1:30 am IST.** Judging runs Dec 1–15, so the demo must stay up until Dec 15.

Legend: ✅ done · ⚠️ needs the owner · ⛔ blocks submission

## Project requirements (section 4)

| Rule | Status | Evidence / action |
|---|---|---|
| Integrates the PayPal developer platform using the free Sandbox | ⚠️ | Invoicing v2 create → send → get → remind → cancel + webhooks (`src/lib/paypal/client.ts`). **Never run against the real Sandbox yet:** add `PAYPAL_CLIENT_ID/SECRET` to `.env.local`, run `npm run check:paypal`, then `npm run test:sandbox`, then the full UI flow once. |
| Uses an AI tool/model of the entrant's choice | ✅ | Google Gemini (`gemini-3.5-flash-lite`), 12/12 live agent checks (TESTING.md) |
| PayPal integration is central to the project | ✅ | The only write path in the app is "approve → PayPal creates and sends the invoice"; status, reminders and analytics come from PayPal data |
| Installs and runs consistently; works as shown in the video | ⚠️ | CI now runs lint, typecheck, tests, build, E2E and a load test on every push. Record the video from the deployed build. |
| New or significantly updated during the Submission Period | ✅ | Repository created 2026-11-09; all 13+ commits are inside the period |
| Authorized use of third-party SDKs/APIs/data | ✅ | AG Grid Community (MIT), Recharts (MIT), @google/genai (Apache-2.0), Gemini API terms, Fontsource fonts (OFL) |

## Submission requirements (section 4)

| Rule | Status | Evidence / action |
|---|---|---|
| Text description of features and functionality | ⚠️ | Draft in `submission/devpost-description.md`. Update before pasting: the hosted demo uses Gemini (not FreeLLMAPI), the test count is now higher, and you can add one line on reliability (AI gate, load test). |
| Access to a functional demo (hosted URL **or** complete setup instructions) | ⚠️ | Setup instructions ✅ in README. Hosted demo: deploy `render.yaml`, set the secrets, then set the repo variable `NEXORA_URL` so the Uptime check keeps it awake. Put the passcode and the sandbox buyer login in the Devpost "testing instructions" field, not in the repo. |
| Public code repository on GitHub/Bitbucket/GitLab | ⛔ | **The repo is private.** GitHub → Settings → General → Danger Zone → Change visibility → Public. History was scanned on 2026-11-11: no keys, only `.env.example` ever committed. |
| Repository contains all source, assets and instructions | ✅ | README "Run it locally" + `.env.example` |
| Open-source license file, visible in the About section | ✅ | `LICENSE` (MIT). GitHub already detects it; it shows in About once the repo is public. |
| Demo video under 3 minutes | ⚠️ | Script in `submission/video-script.md` targets 2:45 |
| Video shows the project functioning on its platform | ⚠️ | Record the real Sandbox flow (not mock mode) |
| Uploaded to YouTube and publicly visible | ⚠️ | Visibility **Public** (not Unlisted/Private); paste the link in the form |
| No third-party trademarks or copyrighted music without permission | ⚠️ | No music, or YouTube Audio Library tracks only. Keep PayPal's own UI as captured; don't add other brands' logos. |

## Prizes

- One entry can win **one** Grand Prize **or** Honorable Mention, **plus one** sponsor prize.
- Sponsor prizes have extra requirements in **section 8**, which wasn't part of the copy checked here. Read section 8 on the Devpost rules page before ticking "Best Use of AG Grid" and follow it exactly.
- AG Grid's own pitch for this hackathon is AG Studio (self-serve dashboards, drag-and-drop charts, AI assistant). NEXORA uses AG Grid Community (sorting, filtering, quick search). If section 8 asks for specific features, plan for that.

## Final hour checklist

- [ ] CI green on `main`
- [ ] Real Sandbox flow done once: create → send → pay as sandbox buyer → *Paid* → reminder
- [ ] Hosted demo reachable in an incognito window on another device; `/api/health` shows `"ok":true`
- [ ] Repo public; LICENSE visible in About
- [ ] YouTube video public, under 3:00
- [ ] Devpost form: description, demo URL, repo URL, video URL, testing instructions (passcode + sandbox buyer), "Built with" tags, sponsor prize selection
- [ ] Submit before **1:30 am IST, Nov 13** (aim for the evening of Nov 12)
