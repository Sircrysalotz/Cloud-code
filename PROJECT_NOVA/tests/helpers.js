/**
 * Shared test helpers. Import these in unit test files (not run_all.js directly).
 */

export let PASS = 0, FAIL = 0;

export function check(label, condition, detail = '') {
  if (condition) {
    PASS++;
    process.stdout.write(`  [pass] ${label}\n`);
  } else {
    FAIL++;
    process.stderr.write(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}\n`);
  }
}

export function section(name) {
  console.log(`\n=== ${name} ===`);
}
