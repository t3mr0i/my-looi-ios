import { createTypeScriptTreeLoader } from "./helpers/load-typescript-tree.mjs";
const loadCharacterModule = createTypeScriptTreeLoader();
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "docs/research/evidence");
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let now = 1_000;
let timerId = 0;
const timers = new Map();
globalThis.setTimeout = (callback, delay = 0, ...args) => {
  const id = ++timerId;
  timers.set(id, { at: now + Math.max(0, Number(delay) || 0), callback: () => callback(...args) });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);

const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
async function tick(ms) {
  const target = now + ms;
  let guard = 0;
  while (guard++ < 1_000) {
    const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush();
  }
  if (guard >= 1_000) throw new Error("Fake clock did not settle");
  now = target; await flush();
}

const expression = loadTypeScript("src/behavior/behavior-expression.ts", { "./behavior-types": {} });
const faceModule = loadCharacterModule("src/character/face-expression.ts");
const gestures = [
  { id: "replay-curious-01", gesture: "curious", mood: "curious", posture: "yield", gaze: { x: 0, y: -0.16 } },
  { id: "replay-happy-02", gesture: "happy_bob", mood: "pleased", posture: "yield" },
  { id: "replay-thinking-03", gesture: "thinking", mood: null, posture: "yield", gaze: { x: 0, y: 0.18 } },
];

async function replay({ name, cue, cancelAt, reducedMotion = false }) {
  const start = now;
  const events = [];
  const controller = new AbortController();
  let current = true;
  let accentAccepted = false;
  const record = (type, fields = {}) => events.push({ atMs: now - start, type, ...fields });
  const animation = expression.runBehaviorExpression({
    ...cue, expiresAt: start + 1_200, generation: 7, presentationOnly: false,
  }, {
    now: () => now,
    signal: controller.signal,
    isCurrent: () => current,
    reducedMotion,
    present(phase, gaze) {
      const mood = phase === "accent" ? cue.mood : null;
      const fixtureVoiceState = "attention";
      const face = faceModule.resolveFaceExpression(fixtureVoiceState, "", mood);
      record("phase", { phase, mood, fixtureVoiceState, gaze: gaze ?? null, face: {
        emotion: face.emotion, leftEyeScaleY: face.leftEyeScaleY, rightEyeScaleY: face.rightEyeScaleY,
        eyeSmile: face.eyeSmile, leftLid: face.leftLid, rightLid: face.rightLid,
        mouth: face.mouth, mouthWidth: face.mouthWidth, headTilt: face.headTilt, lift: face.lift,
      } });
    },
    beginAccent() {
      accentAccepted = current && !controller.signal.aborted && now < start + 1_200;
      record("accent-gate", { accepted: accentAccepted });
      return accentAccepted;
    },
    executeHead() {
      record("mock-head-write", { gesture: cue.gesture, source: "executeHead stub", completed: null });
      return new Promise((resolve) => {
        const timer = globalThis.setTimeout(() => {
          controller.signal.removeEventListener("abort", onAbort);
          record("mock-head-complete", { gesture: cue.gesture, completed: true });
          resolve({ completed: true });
        }, cancelAt === "accent" ? 500 : 260);
        const onAbort = () => {
          globalThis.clearTimeout(timer);
          controller.signal.removeEventListener("abort", onAbort);
          record("mock-head-cancelled", { gesture: cue.gesture });
          resolve({ completed: false });
        };
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    },
    settle() { record("settle-callback"); },
  });
  if (cancelAt === "prepare") globalThis.setTimeout(() => {
    record("STOP", { phaseAtCancel: "prepare" }); current = false; controller.abort();
  }, 75);
  else if (cancelAt === "accent") globalThis.setTimeout(() => {
    record("STOP", { phaseAtCancel: "accent" }); current = false; controller.abort();
  }, 250);
  let finished = false;
  const resultPromise = animation.then((result) => { finished = true; return result; });
  const stopAt = start + (cancelAt === "prepare" ? 100 : cancelAt === "accent" ? 300 : 1_000);
  while (!finished && now < stopAt) await tick(Math.min(10, stopAt - now));
  const result = await resultPromise;
  record("runner-result", { completed: result.completed, accentAccepted });
  return { name, cueId: cue.id, gesture: cue.gesture, gestureMood: cue.mood, fixtureVoiceState: "attention", reducedMotion, startAtMs: 0, events, durationMs: now - start, result: result.completed ? "completed" : "cancelled" };
}

const captured = [];
try {
  for (const cue of gestures) captured.push(await replay({ name: `${cue.gesture}: prepare → accent → settle`, cue }));
  captured.push(await replay({ name: "STOP during preparation", cue: gestures[0], cancelAt: "prepare" }));
  captured.push(await replay({ name: "STOP during head accent", cue: gestures[1], cancelAt: "accent" }));
  captured.push(await replay({ name: "Reduced Motion: accent without spatial holds", cue: gestures[0], reducedMotion: true }));
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

function groupReplayFrames(events) {
  const frames = [];
  for (const event of events) {
    const last = frames.at(-1);
    if (last?.atMs === event.atMs) last.events.push(event);
    else frames.push({ atMs: event.atMs, events: [event] });
  }
  return frames;
}
function stepReplayFrame(index, delta, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), index + delta));
}
const frameFixture = groupReplayFrames([0, 150, 150, 410, 410, 630].map((atMs) => ({ atMs })));
let testFrame = frameFixture.length - 2;
testFrame = stepReplayFrame(testFrame, -1, frameFixture.length);
if (frameFixture[testFrame].atMs !== 150) throw new Error("Back step at 410ms did not reach the previous recorded moment at 150ms");
testFrame = stepReplayFrame(testFrame, -1, frameFixture.length);
if (frameFixture[testFrame].atMs !== 0) throw new Error("Second back step did not reach the first recorded moment");
testFrame = stepReplayFrame(testFrame, 1, frameFixture.length);
if (frameFixture[testFrame].atMs !== 150) throw new Error("Forward step did not return to the next recorded moment");
testFrame = stepReplayFrame(testFrame, 1, frameFixture.length);
if (frameFixture[testFrame].atMs !== 410) throw new Error("Second forward step did not reach 410ms");
if (stepReplayFrame(0, -1, frameFixture.length) !== 0
  || stepReplayFrame(frameFixture.length - 1, 1, frameFixture.length) !== frameFixture.length - 1) {
  throw new Error("Replay frame navigation crossed a boundary");
}

const reduced = captured.at(-1);
if (reduced.events.some((event) => event.type === "phase" && event.phase === "prepare")
  || reduced.events.some((event) => event.type === "phase" && event.phase === "settle")
  || !reduced.events.some((event) => event.type === "phase" && event.phase === "accent" && event.gaze === null)
  || !reduced.events.some((event) => event.type === "settle-callback" && event.atMs < 300)) {
  throw new Error("Reduced Motion replay did not match the runner's no-hold accent contract");
}
if (captured[3].events.some((event) => event.type.startsWith("mock-head"))
  || captured[3].events.some((event) => event.type === "phase" && event.phase === "accent")) {
  throw new Error("STOP during preparation allowed a later accent");
}
if (captured[4].events.some((event) => event.type === "phase" && event.phase === "settle")) {
  throw new Error("STOP during accent allowed a later settle");
}
for (const scenario of [...captured.slice(0, 3), captured[5]]) {
  const accent = scenario.events.find((event) => event.type === "phase" && event.phase === "accent");
  if (!accent || accent.mood !== scenario.gestureMood) {
    throw new Error("Accent replay mood did not match the cue mood");
  }
  for (const phase of scenario.events.filter((event) => event.type === "phase" && event.phase !== "accent")) {
    if (phase.mood !== null || phase.fixtureVoiceState !== "attention") {
      throw new Error("Prepare/settle replay invented mood or omitted the fixture voice state");
    }
  }
}

const payload = {
  title: "Behavior expression replay",
  generatedAt: "2026-10-26",
  evidence: "Captured by invoking src/behavior/behavior-expression.ts with a deterministic fake clock and mock head writer.",
  scope: "Engine-plan replay only. This is not the native app UI, a physical robot test, or evidence of naturalness.",
  timings: { prepareMs: 150, accentHeadStubMs: 260, settleMs: 220, stopPrepAtMs: 75, stopAccentAtMs: 250 },
  scenarios: captured,
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "behavior-expression-replay-2026-10-26.json"), `${JSON.stringify(payload, null, 2)}\n`);
const inline = JSON.stringify(payload).replaceAll("<", "\\u003c");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Behavior expression replay</title>
<style>
:root{color-scheme:dark;--bg:#060b10;--panel:#0b151c;--line:#203740;--cyan:#7be7ee;--muted:#a8bec3;--white:#e7f4f3;--yellow:#f5cd76;--red:#ff8a80;font:16px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 50% -10%,#11353d 0,#09141a 44%,var(--bg) 80%);color:var(--white)}main{max-width:960px;padding:22px 16px 48px;margin:auto}h1{font-size:clamp(1.5rem,5vw,2.2rem);line-height:1.1;margin:0 0 8px;letter-spacing:-.04em}p{margin:0;color:var(--muted)}.eyebrow{color:var(--cyan);font-size:.75rem;font-weight:750;letter-spacing:.13em;text-transform:uppercase;margin-bottom:8px}.notice{border:1px solid #68572f;background:#17160f;color:#f6dfab;padding:12px 14px;border-radius:12px;margin:16px 0 20px;font-size:.92rem}.grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr);gap:14px}.card{background:linear-gradient(160deg,#101d24,#091117);border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 18px 48px #0005}.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0}.frameSteps{display:flex;gap:8px;flex-wrap:nowrap;white-space:nowrap}.controls button,.controls select{background:#13252c;border:1px solid #31525b;color:var(--white);border-radius:10px;padding:9px 12px;font:inherit}.controls button{cursor:pointer}.controls button:focus-visible,.controls select:focus-visible,input:focus-visible{outline:2px solid var(--cyan);outline-offset:2px}.controls label{font-size:.88rem;color:var(--muted);display:flex;align-items:center;gap:8px}#speed{accent-color:var(--cyan)}.face-stage{min-height:240px;display:grid;place-items:center;position:relative;overflow:hidden;border-radius:14px;background:radial-gradient(circle at 50% 40%,#13313a,#081116 68%);border:1px solid #16323a}.robot-face{width:min(60vw,240px);height:min(60vw,240px);max-height:220px;max-width:220px;position:relative;transform-origin:center;transition:transform .16s ease}.eye{position:absolute;top:36%;width:26%;height:31%;border-radius:55% 55% 48% 48%;background:#bffaff;box-shadow:0 0 24px #63e9f355;overflow:hidden;transform-origin:center}.eye.left{left:16%}.eye.right{right:16%}.pupil{position:absolute;left:50%;top:50%;width:40%;height:46%;border-radius:50%;background:#0c252d;transform:translate(calc(-50% + var(--gx)*1px),calc(-50% + var(--gy)*1px));transition:transform .15s ease}.lid{position:absolute;inset:0 0 auto;background:#10252b;transform-origin:top;transform:scaleY(var(--lid));transition:transform .15s ease}.mouth{position:absolute;left:50%;top:78%;width:var(--mw);height:var(--mh);border:2px solid #87edf0;border-top:0;border-radius:0 0 99px 99px;transform:translateX(-50%);transition:all .16s ease}.meta{display:flex;justify-content:space-between;gap:8px;margin-top:10px;font-size:.85rem;color:var(--muted)}.badge{border:1px solid #27616a;color:var(--cyan);border-radius:99px;padding:3px 9px;white-space:nowrap}.timeline{width:100%;accent-color:var(--cyan)}.phase-list{display:flex;gap:6px;margin:12px 0 0;flex-wrap:wrap}.phase{font-size:.77rem;border:1px solid #29414a;border-radius:99px;padding:4px 8px;color:#87a3a9}.phase.active{background:#14373d;border-color:var(--cyan);color:#d7ffff}.diagnostics{margin-top:14px}.diagnostics h2{font-size:1rem;margin:0 0 8px}.event{display:grid;grid-template-columns:62px 1fr auto;gap:8px;border-top:1px solid #1b3038;padding:8px 0;font-size:.84rem}.event time{font-variant-numeric:tabular-nums;color:var(--cyan)}.event .detail{color:#d2e1e1}.event .tag{color:var(--muted);text-align:right}.event.stop .detail{color:var(--red)}.event.head .detail{color:var(--yellow)}.foot{margin-top:18px;font-size:.84rem;color:#88a2a8}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:700px){main{padding:18px 12px 36px}.grid{grid-template-columns:1fr}.face-stage{min-height:220px}.card{padding:14px}.event{grid-template-columns:52px 1fr}.event .tag{grid-column:2;text-align:left}}
</style></head><body><main><h1>Prepare → accent → settle</h1><p>Recorded calls from the real expression runner, replayed on a deterministic clock.</p><div class="notice"><strong>Scope:</strong> This is an engine-plan visualization with screen-gaze values and a mock head writer. It is not the native app UI, a physical robot test, or proof of naturalness. Timings are provisional design defaults.</div>
<div class="controls"><label for="scenario">Scenario</label><select id="scenario"></select><button id="play" type="button">Play</button><button id="pause" type="button">Pause</button><label for="speed">Speed <span id="speedLabel">1×</span></label><input id="speed" type="range" min="0.1" max="2" step="0.1" value="1"><div class="frameSteps"><button id="stepBack" type="button" aria-label="Step back one captured frame">− frame</button><button id="stepForward" type="button" aria-label="Step forward one captured frame">+ frame</button></div></div>
<div class="grid"><section class="card" aria-label="Replay frame"><div class="face-stage"><div class="robot-face" id="robotFace" aria-label="Schematic face rendered from the captured expression shape"><div class="eye left"><div class="pupil"></div><div class="lid"></div></div><div class="eye right"><div class="pupil"></div><div class="lid"></div></div><div class="mouth"></div></div></div><div class="meta"><span id="phaseText">Ready</span><span class="badge" id="headState">Head idle</span></div><input id="scrub" class="timeline" type="range" min="0" max="800" value="0" aria-label="Scrub captured event frames"><div class="phase-list" id="phaseList" aria-label="Expression phases"></div><p class="foot">Pupils show recorded screen gaze. Face geometry uses the local resolver with an explicit attention voice-state fixture; only the accent phase receives the cue mood. This is diagnostic fixture data, not captured native state. The head label reflects only calls made to the mock adapter.</p></section>
<section class="card diagnostics" aria-label="Captured diagnostic events"><h2>Captured runner events</h2><div id="events"></div></section></div><p class="foot">No external assets or network are used. Full captured runner calls and timestamps are also saved as adjacent JSON.</p></main><div id="announcement" class="sr" aria-live="polite"></div>
<script>
const data=__REPLAY_DATA__;
const scenarios=data.scenarios;
const framesByScenario=scenarios.map(function(s){const frames=[];for(const event of s.events){const last=frames[frames.length-1];if(last&&last.atMs===event.atMs)last.events.push(event);else frames.push({atMs:event.atMs,events:[event]});}return frames;});
const picker=document.getElementById('scenario'),scrub=document.getElementById('scrub'),speed=document.getElementById('speed');
let index=0,position=0,frameIndex=0,playing=false,lastFrame=0,raf=0;
scenarios.forEach(function(s,i){const o=document.createElement('option');o.value=i;o.textContent=s.name;picker.append(o);});
function current(){return scenarios[index];}
function latestFrameIndex(frames,time){let found=0;for(let i=0;i<frames.length;i++){if(frames[i].atMs<=time)found=i;else break;}return found;}
function render(requestedFrame){const frames=framesByScenario[index];if(typeof requestedFrame==='number'){frameIndex=Math.max(0,Math.min(frames.length-1,requestedFrame));position=frames[frameIndex].atMs;}else frameIndex=latestFrameIndex(frames,position);scrub.max=Math.max(0,frames.length-1);scrub.value=frameIndex;const visibleEvents=frames.slice(0,frameIndex+1).flatMap(function(frame){return frame.events;});const phase=visibleEvents.filter(function(e){return e.type==='phase';}).at(-1)||null;const head=visibleEvents.filter(function(e){return e.type==='mock-head-write';}).at(-1)||null;const completed=visibleEvents.some(function(e){return e.type==='mock-head-complete';});const stop=visibleEvents.find(function(e){return e.type==='STOP';});document.getElementById('phaseText').textContent=phase?phase.phase+' · '+Math.round(position)+' ms':'Waiting · '+Math.round(position)+' ms';document.getElementById('headState').textContent=stop?'STOP cancelled':head?(completed?'Mock head: '+head.gesture+' · done':'Mock head: '+head.gesture+' · running'):'Head idle';document.getElementById('announcement').textContent=current().name+', '+(phase?phase.phase:'waiting')+', '+Math.round(position)+' milliseconds';const face=document.getElementById('robotFace'),shape=phase?phase.face:null,gaze=phase&&phase.gaze?phase.gaze:{x:0,y:0};face.style.transform='translateY('+(shape?shape.lift:0)+'px) rotate('+(shape?shape.headTilt:0)+'deg)';document.querySelectorAll('.pupil').forEach(function(p){p.style.setProperty('--gx',String(gaze.x*30));p.style.setProperty('--gy',String(gaze.y*30));});document.querySelectorAll('.eye').forEach(function(eye,i){eye.style.transform='scaleY('+(shape?(i?shape.rightEyeScaleY:shape.leftEyeScaleY):1)+')';eye.style.setProperty('--lid',String(shape?(i?shape.rightLid:shape.leftLid):0));});const mouth=document.querySelector('.mouth'),mw=!shape||shape.mouth==='none'?0:shape.mouthWidth?Math.min(52,shape.mouthWidth*3):24;mouth.style.setProperty('--mw',mw+'px');mouth.style.setProperty('--mh',shape&&shape.mouth==='dot'?'5px':'13px');mouth.style.borderRadius=shape&&shape.mouth==='dot'?'50%':'0 0 99px 99px';document.getElementById('phaseList').innerHTML=['prepare','accent','settle'].map(function(p){return '<span class="phase '+(phase&&phase.phase===p?'active':'')+'">'+p+'</span>';}).join('');document.getElementById('events').innerHTML=visibleEvents.map(function(e){let label=e.type==='phase'?'phase: '+e.phase:e.type==='mock-head-write'?'head write requested: '+e.gesture:e.type==='mock-head-complete'?'head write completed: '+e.gesture:e.type==='mock-head-cancelled'?'mock head cancelled: '+e.gesture:e.type==='accent-gate'?'accent gate: '+(e.accepted?'accepted':'rejected'):e.type==='STOP'?'STOP · cancel during '+e.phaseAtCancel:e.type==='settle-callback'?'settle callback':'runner result';const cls=e.type==='STOP'?'stop':e.type.startsWith('mock-head')?'head':'';const gazeLabel=e.gaze?'gaze '+e.gaze.x.toFixed(2)+', '+e.gaze.y.toFixed(2):'';return '<div class="event '+cls+'"><time>'+Math.round(e.atMs)+' ms</time><span class="detail">'+label+'</span><span class="tag">'+gazeLabel+'</span></div>';}).join('')||'<p class="foot">No events yet.</p>';}
function frame(ts){if(!playing)return;if(!lastFrame)lastFrame=ts;position+=(ts-lastFrame)*Number(speed.value);lastFrame=ts;if(position>=current().durationMs){position=current().durationMs;playing=false;}render();if(playing)raf=requestAnimationFrame(frame);}
function play(){if(position>=current().durationMs)position=0;playing=true;lastFrame=0;cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);}
document.getElementById('play').onclick=play;document.getElementById('pause').onclick=function(){playing=false;cancelAnimationFrame(raf);};
document.getElementById('stepBack').onclick=function(){playing=false;cancelAnimationFrame(raf);render(frameIndex-1);};
document.getElementById('stepForward').onclick=function(){playing=false;cancelAnimationFrame(raf);render(frameIndex+1);};
speed.oninput=function(){document.getElementById('speedLabel').textContent=Number(speed.value).toFixed(1)+'×';};
scrub.oninput=function(){playing=false;cancelAnimationFrame(raf);render(Number(scrub.value));};
picker.onchange=function(){playing=false;cancelAnimationFrame(raf);index=Number(picker.value);position=0;render(0);};
render(0);
</script></body></html>`;

fs.writeFileSync(path.join(outputDir, "behavior-expression-replay-2026-10-26.html"), html.replace("__REPLAY_DATA__", inline));
process.stdout.write(`Captured ${captured.length} real-runner timelines.\n`);
