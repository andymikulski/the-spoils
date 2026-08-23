// process-database.js

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function shortId() {
  return crypto.randomBytes(5).toString('base64url');
}

async function processCards(cards) {
  const usedIds = new Set();
  const usedVersionIds = new Set();

  const makeUniqueId = (used) => {
    let id;

    do {
      id = shortId();
    } while (used.has(id));

    used.add(id);
    return id;
  };

  for (const [index, card] of cards.entries()) {
    card.id = makeUniqueId(usedIds);

    const cardDirectory = path.join(process.cwd(), card.id);

    await fs.mkdir(cardDirectory, {
      recursive: true
    });

    for (const version of card.sets ?? []) {
      version.versionId = makeUniqueId(usedVersionIds);

      if (!version.image) {
        console.warn(`No image: ${card.title} / ${version.set}`);
        continue;
      }

      const filename = `${card.id}-${version.versionId}.jpg`;
      const filepath = path.join(cardDirectory, filename);

      try {
        const response = await fetch(version.image);

        if (!response.ok) {
          throw new Error(
            `${response.status} ${response.statusText}`
          );
        }

        const buffer = Buffer.from(
          await response.arrayBuffer()
        );

        await fs.writeFile(filepath, buffer);

        console.log(
          `[${index + 1}/${cards.length}]`,
          card.title,
          '-',
          version.set,
          '->',
          filepath
        );
      } catch (error) {
        console.error(
          `Failed: ${card.title} / ${version.set}`,
          error.message
        );
      }
    }
  }

  return cards;
}

async function main() {
  const databasePath = path.join(
    process.cwd(),
    'database.json'
  );

  const json = await fs.readFile(databasePath, 'utf8');
  const cards = JSON.parse(json);

  const processed = await processCards(cards);

  await fs.writeFile(
    path.join(process.cwd(), 'database-processed.json'),
    JSON.stringify(processed, null, 2)
  );

  console.log(`Processed ${processed.length} cards.`);
}

main().catch(console.error);