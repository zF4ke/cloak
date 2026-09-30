import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";

// Test the packaged Electron app, its sandboxed preload and real installer.
// This is native-app integration, not browser-preview automation.
const directory = await mkdtemp(join(tmpdir(), "cloak-native-"));
const profile = join(directory, "profile"),
  installation = join(directory, "installation");
const port = 43921;
const processes = [];
async function connect(executable, args = [], setup = false) {
  const environment = {
    ...process.env,
    CLOAK_DATA_DIR: profile,
    CLOAK_SETUP_DATA_DIR: installation,
    CLOAK_SETUP_DEBUG_PORT: String(port),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executable,
    [
      ...args,
      ...(setup
        ? []
        : [
            `--remote-debugging-port=${port}`,
            "--remote-debugging-address=127.0.0.1",
          ]),
    ],
    {
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  processes.push(child);
  let output = "";
  child.stderr?.on("data", (bytes) => {
    output += bytes;
  });
  child.stdout?.on("data", (bytes) => {
    output += bytes;
  });
  child.on("error", (error) => {
    console.error(error);
  });
  let target;
  for (let i = 0; i < 120; i++) {
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      ).find((target) => target.type === "page");
      if (target) break;
    } catch {}
    await pause(250);
  }
  if (!target)
    throw new Error(`Native app did not start (${child.exitCode}). ${output}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const requests = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = requests.get(message.id);
      requests.delete(message.id);
      message.error
        ? request?.reject(new Error(message.error.message))
        : request?.resolve(message.result);
    }
  };
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      requests.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const value = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (value.exceptionDetails)
      throw new Error(
        value.exceptionDetails.text +
          ": " +
          value.exceptionDetails.exception?.description,
      );
    return value.result.value;
  };
  await pause(500);
  return { child, socket, call, evaluate };
}
function stop() {
  for (const child of processes.splice(0)) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {}
  }
}
async function screenshot(connection, name) {
  const result = await connection.call("Page.captureScreenshot", {
    format: "png",
  });
  await mkdir("tmp/native", { recursive: true });
  await writeFile(`tmp/native/${name}.png`, Buffer.from(result.data, "base64"));
}
try {
  let native = await connect(resolve("release/Cloak/Cloak.exe"));
  assert.equal(
    await native.evaluate("typeof window.cloak.snapshot"),
    "function",
  );
  assert.equal(await native.evaluate("typeof require"), "undefined");
  const initial = await native.evaluate("window.cloak.snapshot()");
  assert.equal(initial.desktop, true);
  assert.equal(initial.projects.length, 0);
  assert.equal(
    await native.evaluate(
      "getComputedStyle(document.querySelector('.app-frame')).backgroundColor",
    ),
    "rgb(9, 9, 9)",
  );
  const settings = {
    ...initial.settings,
    projectsFolder: join(directory, "projects"),
    linksFolder: join(directory, "links"),
    autoPull: false,
    launchAtLogin: false,
  };
  await native.evaluate(
    `window.cloak.saveSettings(${JSON.stringify(settings)})`,
  );
  await screenshot(native, "projects");
  await native.evaluate(
    "document.querySelector('nav button[aria-label=Settings]').click()",
  );
  for (
    let i = 0;
    i < 40 &&
    !(await native.evaluate(
      "Boolean(document.querySelector('[role=switch]'))",
    ));
    i++
  )
    await pause(100);
  await native.evaluate(
    "(() => {const t=document.querySelector('[role=switch][aria-label=\"Get new commits automatically\"]'); if(t.getAttribute('aria-checked')==='false') t.click()})()",
  );
  await pause(100);
  await native.evaluate("document.querySelector('[role=combobox]').click()");
  await pause(250);
  assert.equal(
    await native.evaluate("Boolean(document.querySelector('[role=listbox]'))"),
    true,
  );
  const gutter = await native.evaluate(
    "(() => {const t=document.querySelector('.select-trigger').getBoundingClientRect(),a=document.querySelector('.select-arrow').getBoundingClientRect();return t.right-a.right})()",
  );
  assert.ok(gutter >= 11);
  await screenshot(native, "dropdown");
  await native.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await native.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await pause(250);
  assert.equal(
    await native.evaluate("Boolean(document.querySelector('[role=listbox]'))"),
    false,
  );
  await native.evaluate(
    await readFile("node_modules/axe-core/axe.min.js", "utf8"),
  );
  const audit = await native.evaluate(
    "axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))",
  );
  assert.deepEqual(audit, []);
  native.socket.close();
  stop();
  await pause(500);
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  native = await connect(
    resolve(`release/Cloak-Setup-${version}.exe`),
    [],
    true,
  );
  const info = await native.evaluate("window.setup.info()");
  assert.equal(info.path, join(installation, "app"));
  await screenshot(native, "setup-welcome");
  const result = await native.evaluate("window.setup.install()");
  assert.equal(result.ok, true, result.error);
  assert.ok(
    (await readFile(join(installation, "app", "Cloak.exe"))).length > 1_000_000,
  );
  assert.ok(
    (await readFile(join(installation, "app", "Uninstall.exe"))).length >
      10_000,
  );
  const retained = JSON.parse(
    await readFile(join(profile, "projects.json"), "utf8"),
  );
  assert.equal(retained.settings.projectsFolder, settings.projectsFolder);
  native.socket.close();
  stop();
  await pause(500);
  const output = execFileSync(
    join(installation, "app", "Cloak.exe"),
    [join(installation, "app", "resources/app/dist/cli.cjs"), "projects"],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        CLOAK_DATA_DIR: profile,
        CLOAK_SCRIPTS_DIR: join(installation, "app", "resources/app/scripts"),
      },
    },
  );
  assert.match(output, /No managed projects/);
  console.log(
    "Native IPC, sandbox, dropdowns, accessibility, NSIS extraction, installation and packaged CLI passed.",
  );
} finally {
  stop();
  await pause(500);
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 250,
  });
}
