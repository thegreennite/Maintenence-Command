// After `vite build` (which writes the app into dist/inspect-funnels/): Cloudflare Pages
// only reads _headers and _redirects from the root of what's deployed, so move them
// there, pointed at /inspect-funnels/. The app's real address is
// revinetic.com/inspect-funnels/ (served from this project by revinetic.com's worker).
import { readFileSync, writeFileSync, rmSync } from "node:fs";

const app = "dist/inspect-funnels";
const headers = readFileSync(`${app}/_headers`, "utf8").replace(/^\/(?=\S)/gm, "/inspect-funnels/");
writeFileSync("dist/_headers", headers);
writeFileSync(
  "dist/_redirects",
  ["/ /inspect-funnels/ 302", "/inspect-funnels /inspect-funnels/ 301", "/inspect-funnels/* /inspect-funnels/index.html 200", ""].join("\n"),
);
rmSync(`${app}/_headers`);
rmSync(`${app}/_redirects`);
console.log("finish-build: _headers and _redirects written to dist/");
