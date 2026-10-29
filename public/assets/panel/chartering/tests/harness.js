// Minimal dependency-free test harness (the project has no Node toolchain).
// Open /assets/panel/chartering/tests/ in a browser, or run it headless (bin/chartering-tests.ps1).
const results = [];
let current = null;

export function test(name, fn) {
    current = { name, checks: [], error: null };
    try {
        fn();
    } catch (e) {
        current.error = e.message;
    }
    results.push(current);
}

function check(ok, label, detail) {
    current.checks.push({ ok, label, detail });
}

/** Relative tolerance in percent (default ±0.5% as the spec allows). */
export function approx(actual, expected, label, tolPct = 0.5) {
    const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= Math.abs(expected) * tolPct / 100 + 1e-9;
    check(ok, label, `expected ≈ ${expected} (±${tolPct}%), got ${Number.isFinite(actual) ? +actual.toFixed(4) : actual}`);
}

/** Absolute tolerance. */
export function near(actual, expected, label, abs = 0.01) {
    const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= abs;
    check(ok, label, `expected ${expected} ±${abs}, got ${Number.isFinite(actual) ? +actual.toFixed(4) : actual}`);
}

export function eq(actual, expected, label) {
    check(Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected), label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export const allResults = () => results;
