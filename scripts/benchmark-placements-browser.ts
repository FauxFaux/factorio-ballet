import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Chrome + a temporary Vite server; no Playwright dependency or existing browser profile.
const profile = await mkdtemp(join(tmpdir(), 'ballet-placement-browser-'));
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5183', '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=9225',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let failures = '';
server.stderr.on('data', (chunk) => {
  failures += String(chunk).slice(0, 2000);
});
chrome.stderr.on('data', (chunk) => {
  failures += String(chunk).slice(0, 2000);
});
let socket: WebSocket | undefined;
try {
  async function ready(url: string) {
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch(url);
        if (response.ok) return response;
      } catch {
        /* wait for the temporary process */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Process did not start: ${url}\n${failures}`);
  }
  await ready('http://127.0.0.1:5183/');
  const targets = (await (await ready('http://127.0.0.1:9225/json')).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  socket = new WebSocket(targets.find((target) => target.type === 'page')!.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket!.onopen = () => resolve();
    socket!.onerror = () => reject(new Error('CDP connection failed'));
  });
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  const errors: unknown[] = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(JSON.stringify(message.error)));
      else request?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
  };
  function call(method: string, params: Record<string, unknown> = {}) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket!.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression: string) {
    const result = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return (result.result as { value: unknown }).value;
  }
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:5183/' });
  await evaluate(
    'new Promise(resolve=>{if(document.readyState==="complete")resolve(true);else addEventListener("load",()=>resolve(true),{once:true})})',
  );
  const measurements = await evaluate(
    '(async()=>{const benchmark=await import("/scripts/placement-benchmark-cases.ts");return benchmark.runPlacementBenchmarks()})()',
  );
  const hash = await evaluate(`(async()=>{
    const {packEnvelope}=await import('/src/boot/url-envelope.ts');
    return packEnvelope({dataset:'space-age-2.1.19',v:1,cs:'',gp:100,ci:0,mo:{},bt:'turbo-transport-belt',
      cl:[{name:'Browser placement benchmark',layout:{},entries:[
        {recipe:'processing-unit',machine:'electromagnetic-plant',count:24,beacons:1},
        {recipe:'advanced-circuit',machine:'electromagnetic-plant',beacons:1},
        {recipe:'electronic-circuit',machine:'electromagnetic-plant',beacons:1},
        {recipe:'casting-copper-cable',machine:'foundry',beacons:1},
        {recipe:'casting-iron',machine:'foundry',beacons:1}]}]});
  })()`);
  const observerSource = `
    window.placementLongTasks=[];
    new PerformanceObserver(list=>window.placementLongTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask'});
  `;
  await call('Page.addScriptToEvaluateOnNewDocument', { source: observerSource });
  await evaluate(observerSource);
  const began = performance.now();
  const url = `http://127.0.0.1:5183/#${hash}`;
  await call('Page.navigate', { url });
  for (let i = 0; i < 200; i++) {
    const ready = await evaluate(
      `location.href===${JSON.stringify(url)} && !!document.querySelector('[aria-label="Layout"]')`,
    );
    if (ready) break;
    if (i === 199) throw new Error('Cell layout did not render');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()==='as json').click()`,
  );
  for (let i = 0; i < 200; i++) {
    if (await evaluate(`!!document.querySelector('[aria-label="Cell solution JSON"] textarea')`))
      break;
    if (i === 199) throw new Error('Cell kernels did not finish');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const ui = await evaluate(`(async()=>{
    const solution=JSON.parse(document.querySelector('[aria-label="Cell solution JSON"] textarea').value);
    const toggle=document.querySelector('[aria-label="Show recipes horizontally"]');
    const start=performance.now();toggle.click();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {recipeCounts:solution.recipes.map(row=>({recipe:row.recipe,count:row.count})),
      interactionToTwoFramesMs:performance.now()-start,longTasks:window.placementLongTasks,
      layoutPresent:!!document.querySelector('[aria-label="Layout"]'),bodyText:document.body.innerText.slice(-1000)};
  })()`);
  const uiReadyMs = performance.now() - began;
  const screenshot = await call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(join(profile, 'cell.png'), Buffer.from(screenshot.data as string, 'base64'));
  const report = { measurements, uiReadyMs, ui, browserExceptions: errors };

  const path = join(profile, 'report.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: path, ...report }, null, 2));
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  server.kill('SIGTERM');
}
