// Refuses to publish the landing site while required details are still placeholders.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "site/public/privacy.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const missing = page.match(/\[[A-Z][A-Z ]+\]/g);

if (missing) {
  console.error(`site/public/privacy.html still has placeholders: ${[...new Set(missing)].join(", ")}`);
  console.error("Fill in who operates the service and a contact address before publishing.");
  process.exit(1);
}
console.log("privacy page: no placeholders left");
