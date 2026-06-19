// Tiny no-build test harness. Works in both the browser (tests/index.html)
// and Node (`node tests/dates.test.js`). No dependencies.

export function createSuite(name) {
  const results = [];

  function record(ok, label, detail) {
    results.push({ ok, label, detail: detail || '' });
  }

  function test(label, fn) {
    try {
      fn();
      record(true, label);
    } catch (err) {
      record(false, label, err && err.message ? err.message : String(err));
    }
  }

  function eq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(
        (msg ? msg + ': ' : '') + `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  }

  function deepEq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error((msg ? msg + ': ' : '') + `expected ${e}, got ${a}`);
    }
  }

  function ok(value, msg) {
    if (!value) throw new Error(msg || 'expected truthy value');
  }

  function throws(fn, msg) {
    let threw = false;
    try { fn(); } catch (_) { threw = true; }
    if (!threw) throw new Error(msg || 'expected function to throw');
  }

  return { name, results, test, eq, deepEq, ok, throws };
}

// In Node, print a summary and exit non-zero on failure.
export function reportToConsole(suites) {
  let failed = 0;
  for (const s of suites) {
    for (const r of s.results) {
      if (!r.ok) failed++;
      const tag = r.ok ? 'PASS' : 'FAIL';
      const line = `[${tag}] ${s.name} — ${r.label}` + (r.detail ? `\n        ${r.detail}` : '');
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }
  const total = suites.reduce((n, s) => n + s.results.length, 0);
  // eslint-disable-next-line no-console
  console.log(`\n${total - failed}/${total} passed.`);
  return failed;
}
