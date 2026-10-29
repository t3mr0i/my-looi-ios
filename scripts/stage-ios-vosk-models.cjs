const fs = require('node:fs');
const path = require('node:path');

function stageIosVoskModels(root) {
  const names = ['vosk-command-ru', 'vosk-command-uk', 'vosk-command-en', 'vosk-command-de'];
  const source = path.join(root, '.build-assets/vosk');
  // Validate every input before replacing any generated bundle.
  for (const name of names) {
    if (!fs.existsSync(path.join(source, name, 'am/final.mdl'))) {
      throw new Error(`Missing Vosk model ${name}; run bash scripts/download-vosk-command-models.sh before iOS prebuild.`);
    }
  }
  const destination = path.join(root, 'modules/vosk-command-recognizer/ios/Models');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of names) {
    const bundle = path.join(destination, `${name}.bundle`);
    fs.rmSync(bundle, { recursive: true, force: true });
    fs.cpSync(path.join(source, name), bundle, { recursive: true, dereference: true });
  }
}
module.exports = { stageIosVoskModels };
if (require.main === module) stageIosVoskModels(path.resolve(__dirname, '..'));
