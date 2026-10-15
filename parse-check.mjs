import { readFileSync, readdirSync } from "node:fs";
import pkg from "libpg-query";

const { parseSync, loadModule } = pkg;

await loadModule();

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let bad = 0;

for (const f of files) {
  const sql = readFileSync(`${dir}/${f}`, "utf8");
  try {
    const res = parseSync(sql);
    console.log(`  OK    ${f}  (${res.stmts.length} statements)`);
  } catch (e) {
    bad++;
    const msg = String(e.message ?? e);
    let loc = "";
    const m = msg.match(/LINE (\d+)/i) || msg.match(/line (\d+)/i);
    if (m) loc = `  [near line ${m[1]}]`;
    console.log(`  FAIL  ${f}${loc}\n        ${msg.split("\n")[0]}`);
  }
}

console.log(bad === 0 ? "\nAll migrations parse cleanly." : `\n${bad} file(s) failed to parse.`);
process.exit(bad === 0 ? 0 : 1);
