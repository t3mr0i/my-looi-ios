import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
import { renderCharacterScenePicture } from "./helpers/character-scene-picture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { getCharacterScene } = createTypeScriptTreeLoader()(path.join(root, "src/character/character-scene-catalog.ts"));
const folder = path.join(root, "output/character-expression-review");
fs.mkdirSync(folder, { recursive: true });
const feelings = ["Traurig", "Konzentriert", "Fröhlich", "Besorgt", "Verärgert", "Überrascht", "Unklar"];
const actions = ["Trinken", "Kaffeepause", "Keks essen", "Lesen", "Tee anbieten", "Pizza teilen", "Unklar"];
const cases = [
  ["sadness", "Traurig"], ["study", "Konzentriert"], ["joy", "Fröhlich"],
  ["comfort", "Besorgt"], ["anger", "Verärgert"], ["surprise", "Überrascht"],
  ["drink", "Trinken"], ["coffee", "Kaffeepause"], ["snack", "Keks essen"],
  ["read", "Lesen"], ["tea", "Tee anbieten"], ["pizza", "Pizza teilen"],
].map(([id, expected], index) => {
  const showProp = index >= 6;
  const raw = fs.readFileSync(path.join(root, "assets/character-scenes/props", `${id}.svg`), "utf8");
  const svg = renderCharacterScenePicture(getCharacterScene(id), raw, { showProp }).replace(/<title>[\s\S]*?<\/title>/u, "");
  return { id, expected, showProp, choices: showProp ? actions : feelings,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
});
const html = String.raw`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LOOI · Ausdruck erkennen</title><style>
*{box-sizing:border-box}body{margin:0;background:#020810;color:#edf7ff;font:16px system-ui,sans-serif}main{max-width:680px;margin:auto;padding:24px}h1{font-size:26px}p{color:#a3b5c5;line-height:1.5}img{display:block;width:min(360px,100%);height:auto;margin:auto}fieldset{border:0;padding:0;margin:20px 0;display:flex;flex-wrap:wrap;gap:10px}legend{margin-bottom:14px}button{font:inherit;color:#edf7ff;border:1px solid #385973;border-radius:12px;background:#0a1b2b;padding:12px 16px;min-height:48px;cursor:pointer}button:hover,button:focus-visible{border-color:#82eaf8;outline:2px solid #82eaf8;outline-offset:2px}small{color:#a3b5c5}pre{white-space:pre-wrap;line-height:1.5}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #294154}
</style><main><h1>Was drückt LOOI aus?</h1><p id="intro">Zwölf Bilder, ohne Titel und in zufälliger Reihenfolge. Wähle deinen ersten Eindruck. „Unklar“ ist eine hilfreiche Antwort. Die Auswertung erscheint erst am Ende. Diese Prüfung zeigt die Schlüsselpose; Bewegung wird damit nicht bewertet.</p><p id="progress" role="status" aria-live="polite"></p><div id="trial"><img id="picture" alt="Unbeschrifteter Gesichtsausdruck"><fieldset id="answers"><legend id="question"></legend></fieldset></div><section id="result" hidden><h2>Auswertung</h2><p id="score"></p><p>Ein einzelner Durchlauf ist keine allgemeine Bestätigung. Für einen unabhängigen Test sollten Personen teilnehmen, die die vorgesehenen Ausdrücke vorher nicht kennen. Verwechslungen und „Unklar“ zählen als Hinweise zur Überarbeitung.</p><table><thead><tr><th>Vorgesehen</th><th>Erkannt</th></tr></thead><tbody id="rows"></tbody></table><p><button id="download">Antworten speichern</button></p></section><small>Bleibt lokal im Browser. Es werden keine Antworten automatisch übertragen.</small></main>
<script>
const cases=__CASES__;
for(let i=cases.length-1;i>0;i--){const n=new Uint32Array(1);crypto.getRandomValues(n);const j=n[0]%(i+1);[cases[i],cases[j]]=[cases[j],cases[i]]}
let index=0,started=performance.now();const responses=[];
const picture=document.querySelector('#picture'),answers=document.querySelector('#answers'),question=document.querySelector('#question');
function render(){const c=cases[index];picture.src=c.image;picture.alt=c.showProp?'Unbeschriftete Szene':'Unbeschrifteter Gesichtsausdruck';question.textContent=c.showProp?'Welche Handlung erkennst du?':'Welchen Ausdruck erkennst du?';answers.querySelectorAll('button').forEach(b=>b.remove());for(const choice of c.choices){const b=document.createElement('button');b.type='button';b.textContent=choice;b.onclick=()=>answer(choice);answers.append(b)}document.querySelector('#progress').textContent='Bild '+(index+1)+' von '+cases.length;started=performance.now()}
function answer(choice){const c=cases[index];responses.push({id:c.id,kind:c.showProp?'scene':'face',expected:c.expected,selected:choice,responseMs:Math.round(performance.now()-started)});index++;if(index<cases.length){render();answers.querySelector('button').focus();return}document.querySelector('#trial').hidden=true;document.querySelector('#result').hidden=false;document.querySelector('#progress').textContent='Alle zwölf Antworten erfasst';document.querySelector('#score').textContent=responses.filter(r=>r.selected===r.expected).length+' von 12 wie vorgesehen erkannt.';for(const r of responses){const row=document.createElement('tr');for(const value of [r.expected,r.selected]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}document.querySelector('#rows').append(row)}}
document.querySelector('#download').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,createdAt:new Date().toISOString(),method:'unlabelled-key-pose',responses},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='looi-ausdruckstest.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};render();
</script></html>`;
fs.writeFileSync(path.join(folder, "recognition.html"), html.replace("__CASES__", JSON.stringify(cases).replaceAll("<", "\\u003c")));
console.log("Prepared 12 unlabelled key poses. No human recognition results have been collected.");
