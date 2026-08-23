// fix-ids.js

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DATABASE = 'database-processed.json';

function needsFix(id) {
  return id?.startsWith('_') || id?.startsWith('-');
}

function newId(length = 7) {
  // Alphanumeric only - no "_" or "-"
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  const bytes = crypto.randomBytes(length);

  return [...bytes]
    .map(byte => chars[byte % chars.length])
    .join('');
}

function uniqueId(used) {
  let id;

  do {
    id = newId();
  } while (used.has(id));

  used.add(id);
  return id;
}

async function exists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const cwd = process.cwd();
  const databasePath = path.join(cwd, DATABASE);

  const cards = JSON.parse(
    await fs.readFile(databasePath, 'utf8')
  );

  const usedCardIds = new Set(cards.map(card => card.id));
  const usedVersionIds = new Set(
    cards.flatMap(card =>
      (card.sets ?? []).map(version => version.versionId)
    )
  );

  for (const card of cards) {
    const oldCardId = card.id;
    let newCardId = oldCardId;

    // Fix card ID
    if (needsFix(oldCardId)) {
      usedCardIds.delete(oldCardId);
      newCardId = uniqueId(usedCardIds);

      console.log(
        `Card ID: ${oldCardId} -> ${newCardId}`
      );

      card.id = newCardId;
    }

    const oldDir = path.join(cwd, oldCardId);
    const newDir = path.join(cwd, newCardId);

    // Fix version IDs and filenames
    for (const version of card.sets ?? []) {
      const oldVersionId = version.versionId;
      let newVersionId = oldVersionId;

      if (needsFix(oldVersionId)) {
        usedVersionIds.delete(oldVersionId);
        newVersionId = uniqueId(usedVersionIds);

        console.log(
          `Version ID: ${oldVersionId} -> ${newVersionId}`
        );

        version.versionId = newVersionId;
      }

      const oldFilename =
        `${oldCardId}-${oldVersionId}.jpg`;

      const newFilename =
        `${newCardId}-${newVersionId}.jpg`;

      const oldFile = path.join(oldDir, oldFilename);
      const newFile = path.join(oldDir, newFilename);

      if (
        oldFilename !== newFilename &&
        await exists(oldFile)
      ) {
        if (await exists(newFile)) {
          throw new Error(
            `File conflict: ${newFile}`
          );
        }

        await fs.rename(oldFile, newFile);

        console.log(
          `File: ${oldFilename} -> ${newFilename}`
        );
      }
    }

    // Rename the card directory last.
    if (oldCardId !== newCardId && await exists(oldDir)) {
      if (await exists(newDir)) {
        // Extremely unlikely, but generate another ID
        // until the filesystem path is free.
        let replacement;

        do {
          replacement = uniqueId(usedCardIds);
        } while (
          await exists(path.join(cwd, replacement))
        );

        console.log(
          `Directory conflict: ${newCardId} -> ${replacement}`
        );

        // Rename filenames again to use final card ID.
        for (const version of card.sets ?? []) {
          const currentFile = path.join(
            oldDir,
            `${newCardId}-${version.versionId}.jpg`
          );

          const replacementFile = path.join(
            oldDir,
            `${replacement}-${version.versionId}.jpg`
          );

          if (await exists(currentFile)) {
            await fs.rename(
              currentFile,
              replacementFile
            );
          }
        }

        card.id = replacement;
        newCardId = replacement;
      }

      await fs.rename(
        oldDir,
        path.join(cwd, newCardId)
      );

      console.log(
        `Directory: ${oldCardId}/ -> ${newCardId}/`
      );
    }
  }

  await fs.writeFile(
    databasePath,
    JSON.stringify(cards, null, 2)
  );

  console.log('Done.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});