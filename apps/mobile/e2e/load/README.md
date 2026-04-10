# Load Tests

Task #23 (Tier 4 — P14-3)

Tests targeting `play-cards`, `find-match`, and `complete-game` edge functions under concurrent load.

Two equivalent options are provided:

---

## Option A — k6 (recommended for CI/CD)

### Install k6

```bash
# macOS
brew install k6

# Linux / CI (Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Run

```bash
k6 run \
  --env SUPABASE_URL=https://dppybucldqufbqhwnkxu.supabase.co \
  --env ANON_KEY=<your-anon-key> \
  --env SERVICE_ROLE_KEY=<your-service-role-key> \
  apps/mobile/e2e/load/k6-load-test.js
```

### CI usage

The k6 load test job in `.github/workflows/test.yml` runs only on `workflow_dispatch`
(manual trigger) to avoid incurring Supabase costs on every PR.

---

## Option B — Artillery (npm-based, zero binary install)

### Run

```bash
SUPABASE_URL=https://dppybucldqufbqhwnkxu.supabase.co \
ANON_KEY=<your-anon-key> \
npx artillery run apps/mobile/e2e/load/artillery.config.yml
```

### Install as dev dependency (optional)

```bash
cd apps/mobile && pnpm add -D artillery
```

---

## Thresholds

| Metric | Target |
|--------|--------|
| p95 response time | < 2 s |
| p99 response time | < 3 s |
| 5xx error rate | < 10 % |

401 responses are expected (unauthenticated scenarios) and are **not** counted as errors.
