const crypto = require('node:crypto');
const fs = require('node:fs');

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

module.exports = { sha256File };
