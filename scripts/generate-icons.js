const fs = require("fs");
const sharp = require("sharp");

const originalSvg = fs.readFileSync("favicon.svg", "utf8");
const blackSvg = originalSvg.replace(
  /<style>[\s\S]*?<\/style>/,
  "<style>path{fill:#000}</style>",
);

async function render(size, out) {
  await sharp(Buffer.from(blackSvg)).resize(size, size).png().toFile(out);
}

(async () => {
  await render(64, "ICON.PNG");
  await render(256, "ICON_256.PNG");
  await render(64, "app/ui/images/icon_64.png");
  await render(256, "app/ui/images/icon_256.png");
})();
