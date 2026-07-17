# FixSight — working prototype

Point your phone at a problem, get a first-level expert diagnosis: likely issue, probable cause,
severity, repair options, DIY-vs-pro call, and a shareable repair summary.

**How it works:** a small Express server serves a mobile-first web app and proxies photo scans to
the Claude vision API (`claude-opus-4-8`) with a structured-output schema, so every response is a
guaranteed-valid diagnosis JSON. The model may ask up to 3 follow-up questions before diagnosing.

## Run it

```powershell
npm install
copy .env.example .env     # then paste your Anthropic API key into .env
npm start
```

Open http://localhost:3000

## Try it on your phone

The camera flow is designed for mobile. With your phone on the same Wi-Fi network:

1. Find your PC's local IP: `ipconfig` → IPv4 Address (e.g. `192.168.1.25`)
2. On your phone, open `http://192.168.1.25:3000`
3. If it doesn't load, allow Node.js through Windows Firewall (private networks).

## Project layout

```
server.js          Express server + Claude API call (system prompt, JSON schema)
public/index.html  Single-page app shell
public/app.js      Scan flow: photo → questions → diagnosis card → history
public/style.css   Mobile-first styles
```

## What's in the diagnosis card

- Likely diagnosis + confidence
- Severity score (1–10) with label
- Probable cause
- Recommended repair / cheapest safe fix / temporary fix
- DIY vs professional call + difficulty + tools & parts
- Risk if ignored + estimated cost range
- Safety warnings when relevant
- One-tap **Copy repair summary** — plain-text report for a contractor, landlord, or insurer

Scan history is stored locally in the browser (localStorage), last 20 scans.

## Notes

- Each scan costs roughly $0.02–0.06 in API usage depending on image size and follow-ups.
- FixSight is a first opinion, not an inspection. The UI and prompt are deliberately
  conservative about electrical, gas, and structural issues.
