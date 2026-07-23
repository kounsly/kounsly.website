# Kounsly — website

Kounsly — a plain-English matcher for English-taught university programs worldwide.
Ask in natural language (EN/UA) → get matched programs with tuition, deadlines and requirements,
with an honest focus on free / low-cost options. Unbiased: no agent, no commission, no pay-to-rank.

> **Prototype / MVP.** This is a frontend-only static page with **sample (illustrative) data**.
> The live version will pull real, sourced figures via an LLM + web-search backend.

## Stack
- Single self-contained `index.html` (HTML + CSS + vanilla JS, no build step, no dependencies).
- Client-side natural-language matcher over a sample dataset (28 programs, 6 continents).
- Features: NL search, region → country / field / level / budget filters, sorting,
  “why it fits” reasons, EN/UA language toggle, light/dark theme.

## Run locally
Just open `index.html` in a browser — no server needed.

## Deploy (Coolify)
Deployed via Coolify using the included `Dockerfile` (nginx serving the static page on port 80).
