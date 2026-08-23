const fs = require("fs");
const path = require("path");

const cards = JSON.parse(fs.readFileSync("cards.json", "utf8"));
const assetsDir = path.resolve("./assets");

fs.mkdirSync(assetsDir, { recursive: true });

async function main() {
  let i = 0;
  for (const item of cards) {
    i ++;
    const { id, set } = item;

    const url = `https://res.cloudinary.com/dyosufzhf/image/upload/the-spoils/${set}/${id}.jpg`;
    const outputPath = path.join(assetsDir, `${id}.jpg`);

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`Failed ${id}: ${response.status} ${url}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);

      console.log(`Downloaded ${id}.jpg`);
    } catch (err) {
      console.error(`Error downloading ${id}:`, err.message);
    }
  }
}

main();