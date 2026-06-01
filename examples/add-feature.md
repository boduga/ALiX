# Example: Add a /healthz endpoint

**Task:**
```bash
alix run "add a GET /healthz endpoint that returns 200 with { status: 'ok', uptime: process.uptime() }"
```

**What ALiX does:**

1. Classifies as `feature`
2. Finds the Express router setup
3. Adds the endpoint
4. Runs tests
5. Repairs if anything fails

**Expected output:**

```
Classified: feature
Context: src/server.ts, src/routes/

Added:
+ router.get('/healthz', (req, res) => {
+   res.json({ status: 'ok', uptime: process.uptime() });
+ });

Verification: ✓ Tests pass
```

**Time:** ~45 seconds