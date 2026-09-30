import { spawn, execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
import { once } from "node:events";

// Test the packaged Electron app, its sandboxed preload and real installer.
// This is native-app integration, not browser-preview automation.
const directory = await mkdtemp(join(tmpdir(), "cloak-native-"));
const installLocal = process.argv.includes("--install-local");
const profile = join(directory, "profile"),
  installation = installLocal
    ? join(process.env.LOCALAPPDATA, "cloak")
    : join(directory, "installation");
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
  if (installLocal && setup) delete environment.CLOAK_SETUP_DATA_DIR;
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
  await call("Page.bringToFront", {});
  await call("Emulation.setFocusEmulationEnabled", { enabled: true });
  await pause(500);
  return { child, socket, call, evaluate };
}
function stop() {
  for (const child of processes.splice(0)) {
    if (child.exitCode !== null) continue;
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
  for (const name of ["Reader", "Arcade"]) {
    const source = join(directory, "incoming", name);
    const remote = join(directory, `${name}.git`);
    await mkdir(source, { recursive: true });
    const git = (args) =>
      execFileSync("git", args, {
        cwd: source,
        windowsHide: true,
        stdio: "pipe",
      });
    git(["init", "--bare", remote]);
    git(["init", "-b", "main"]);
    git(["config", "user.name", "Cloak test"]);
    git(["config", "user.email", "test@example.invalid"]);
    await writeFile(join(source, "README.md"), `# ${name}\n`);
    git(["add", "README.md"]);
    git(["commit", "-m", "Initial fixture"]);
    git(["remote", "add", "origin", remote]);
    const added = await native.evaluate(
      `window.cloak.create(${JSON.stringify({ mode: "import", name, source, repository: remote, visibility: "private", createRepository: false, useRemote: true })})`,
    );
    assert.equal(added.warning, undefined);
    assert.equal(added.project.link, join(settings.linksFolder, `${name}.lnk`));
    assert.equal((await lstat(added.project.link)).isFile(), true);
    assert.equal((await lstat(added.project.link)).isSymbolicLink(), false);
    const shortcut = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve("release/Cloak/resources/app/scripts/project-shortcut.ps1"),
          "-Encoded",
          Buffer.from(
            JSON.stringify({ action: "read", path: added.project.link }),
          ).toString("base64"),
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    assert.equal(shortcut.target, added.project.path);
    assert.equal(shortcut.arguments, "");
  }
  await native.call("Page.reload", {});
  await pause(1500);
  await screenshot(native, "projects");
  await native.evaluate(
    "document.querySelector('.action-tile.purple').click()",
  );
  await pause(400);
  assert.equal(
    await native.evaluate(
      "getComputedStyle(document.querySelector('.step-track > div')).transform",
    ),
    "matrix(0, 0, 0, 1, 0, 0)",
  );
  await native.call("Input.insertText", { text: "Journal" });
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  await pause(400);
  await screenshot(native, "onboarding");
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  await pause(400);
  for (
    let i = 0;
    i < 100 &&
    !(await native.evaluate(
      "document.querySelector('.review h3')?.textContent==='Journal'",
    ));
    i++
  )
    await pause(100);
  assert.match(
    await native.evaluate("document.querySelector('dialog').innerText"),
    /Journal/,
  );
  await native.evaluate(
    "document.querySelector('dialog button[aria-label=Close]').click()",
  );
  await pause(400);
  const broken = join(directory, "incoming", "Broken");
  await mkdir(broken, { recursive: true });
  execFileSync("git", ["init", "-b", "main", broken], {
    windowsHide: true,
    stdio: "pipe",
  });
  execFileSync(
    "git",
    [
      "-C",
      broken,
      "remote",
      "add",
      "origin",
      "https://github.com/cloak-test/project.git",
    ],
    { windowsHide: true, stdio: "pipe" },
  );
  execFileSync(
    "git",
    ["-C", broken, "config", "branch.main.remote", "origin"],
    { windowsHide: true, stdio: "pipe" },
  );
  execFileSync(
    "git",
    ["-C", broken, "config", "branch.main.merge", "refs/heads/main"],
    { windowsHide: true, stdio: "pipe" },
  );
  await writeFile(join(broken, ".git", "index"), "");
  await native.evaluate(
    "[...document.querySelectorAll('.action-tile')].find(b=>b.textContent.includes('Add existing')).click()",
  );
  await pause(350);
  await native.call("Input.insertText", { text: broken });
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  for (
    let i = 0;
    i < 40 &&
    !(await native.evaluate(
      "Boolean(document.querySelector('.recovery-choice'))",
    ));
    i++
  )
    await pause(100);
  assert.equal(
    await native.evaluate(
      "document.querySelector('dialog .button.primary').disabled",
    ),
    true,
  );
  assert.equal(
    await native.evaluate(
      "document.querySelector('.recovery-choice [role=switch]').getAttribute('aria-checked')",
    ),
    "false",
  );
  await screenshot(native, "recovery-choice");
  await native.evaluate(
    await readFile("node_modules/axe-core/axe.min.js", "utf8"),
  );
  assert.deepEqual(
    await native.evaluate(
      "axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>r.violations.map(v=>v.id))",
    ),
    [],
  );
  await native.evaluate(
    "document.querySelector('.recovery-choice [role=switch]').focus()",
  );
  await native.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
  });
  await native.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
  });
  assert.equal(
    await native.evaluate(
      "document.querySelector('.recovery-choice [role=switch]').getAttribute('aria-checked')",
    ),
    "true",
  );
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  for (
    let i = 0;
    i < 60 &&
    !(await native.evaluate(
      "document.querySelectorAll('dialog input').length === 3",
    ));
    i++
  )
    await pause(100);
  assert.deepEqual(
    await native.evaluate(
      "[...document.querySelectorAll('dialog input')].map(i=>i.value)",
    ),
    ["Broken", "https://github.com/cloak-test/project.git", "main"],
  );
  await pause(250);
  await screenshot(native, "recovery-repository");
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  await pause(400);
  assert.match(
    await native.evaluate("document.querySelector('dialog').innerText"),
    /Replaces all local files and unpublished commits, including ignored files/,
  );
  assert.equal(
    await native.evaluate(
      "document.querySelector('dialog .button.primary').textContent.trim()",
    ),
    "Replace and add",
  );
  assert.equal(
    await native.evaluate(
      "(() => {const body=document.querySelector('.modal-content').getBoundingClientRect(),warning=document.querySelector('.review .notice').getBoundingClientRect();return warning.top>=body.top&&warning.bottom<=body.bottom})()",
    ),
    true,
  );
  await screenshot(native, "recovery-review");
  assert.equal(
    await native.evaluate(
      "getComputedStyle(document.querySelector('.step.current > span:first-child')).boxShadow",
    ),
    "none",
  );
  assert.equal(
    await native.evaluate(
      "(() => { const track=document.querySelector('.step-track').getBoundingClientRect(), fill=document.querySelector('.step-track > div').getBoundingClientRect(), end=document.querySelector('.step.current > span:first-child').getBoundingClientRect(); return Math.abs(fill.right-track.right)<1 && fill.right>=end.left; })()",
    ),
    true,
  );
  const locks = await native.evaluate(
    `window.cloak.folderLocks(${JSON.stringify(broken)})`,
  );
  assert.equal(typeof locks.available, "boolean");
  assert.equal(Array.isArray(locks.apps), true);
  await assert.rejects(
    native.evaluate("window.cloak.closeFolderLocks('invalid',true)"),
    /Check locking apps again/,
  );
  await native.call("Emulation.setDeviceMetricsOverride", {
    width: 620,
    height: 420,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await pause(250);
  assert.equal(
    await native.evaluate(
      "(() => {const body=document.querySelector('.modal-content').getBoundingClientRect(),warning=document.querySelector('.review .notice').getBoundingClientRect(),footer=document.querySelector('.modal-footer').getBoundingClientRect();return warning.top>=body.top&&warning.bottom<=body.bottom&&footer.bottom<=innerHeight})()",
    ),
    true,
  );
  await screenshot(native, "recovery-review-small");
  await native.call("Emulation.clearDeviceMetricsOverride", {});
  await native.evaluate(
    "document.querySelector('dialog button[aria-label=Close]').click()",
  );
  await pause(400);
  // A real isolated directory lock drives the complete unlock UI and native IPC.
  const locked = join(directory, "incoming", "Locked");
  execFileSync("git", ["clone", join(directory, "Reader.git"), locked], {
    windowsHide: true,
    stdio: "pipe",
  });
  const locker = spawn(
    process.execPath,
    ["-e", "process.stdout.write('ready\\n');process.stdin.resume()"],
    { cwd: locked, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  processes.push(locker);
  await once(locker.stdout, "data");
  await native.evaluate("document.querySelector('.action-tile.blue').click()");
  await pause(300);
  await native.call("Input.insertText", { text: locked });
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  for (
    let i = 0;
    i < 60 &&
    !(await native.evaluate(
      "document.querySelector('dialog').innerText.includes('Use this repository')",
    ));
    i++
  )
    await pause(100);
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  await pause(350);
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  for (
    let i = 0;
    i < 60 &&
    !(await native.evaluate(
      "Boolean(document.querySelector('.folder-unlock'))",
    ));
    i++
  )
    await pause(100);
  assert.match(
    await native.evaluate("document.querySelector('dialog').innerText"),
    /folder is open/,
  );
  await native.evaluate(
    "document.querySelector('.folder-unlock .button').click()",
  );
  for (
    let i = 0;
    i < 100 &&
    !(await native.evaluate(
      "Boolean(document.querySelector('.locking-apps')) || [...document.querySelectorAll('.folder-unlock button')].some(b=>b.textContent.trim()==='Get PowerToys')",
    ));
    i++
  )
    await pause(100);
  if (locks.available) {
    assert.match(
      await native.evaluate(
        "document.querySelector('.locking-apps').innerText",
      ),
      /node/,
    );
    assert.equal(
      await native.evaluate(
        "[...document.querySelectorAll('.folder-unlock button')].some(b=>b.textContent.trim()==='End tasks')",
      ),
      false,
    );
    await pause(350);
    const unlockBounds = await native.evaluate(
      "(() => { const body=document.querySelector('.modal-content').getBoundingClientRect(),panel=document.querySelector('.folder-unlock').getBoundingClientRect();return {bodyTop:body.top,bodyBottom:body.bottom,panelTop:panel.top,panelBottom:panel.bottom} })()",
    );
    await screenshot(native, "unlock-folder");
    assert.ok(
      unlockBounds.panelTop >= unlockBounds.bodyTop - 1 &&
        unlockBounds.panelBottom <= unlockBounds.bodyBottom + 1,
      JSON.stringify(unlockBounds),
    );
    await native.evaluate(
      "[...document.querySelectorAll('.folder-unlock button')].find(b=>b.textContent.trim()==='End locking tasks').click()",
    );
    await pause(350);
    await native.evaluate(
      "document.querySelector('.folder-unlock').scrollIntoView({block:'nearest'})",
    );
    assert.equal(
      await native.evaluate(
        "document.querySelector('.folder-unlock .button.danger').disabled",
      ),
      true,
    );
    await native.evaluate(
      "document.querySelector('.folder-unlock [role=switch]').click()",
    );
    assert.equal(
      await native.evaluate(
        "document.querySelector('.folder-unlock .button.danger').disabled",
      ),
      false,
    );
    assert.deepEqual(
      await native.evaluate(
        "axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>r.violations.map(v=>v.id))",
      ),
      [],
    );
    await screenshot(native, "unlock-confirm");
    await native.evaluate(
      "document.querySelector('.folder-unlock .button.danger').click()",
    );
    for (
      let i = 0;
      i < 100 &&
      !(await native.evaluate(
        "document.querySelector('.folder-unlock').innerText.includes('No locking apps found')",
      ));
      i++
    )
      await pause(100);
    assert.match(
      await native.evaluate(
        "document.querySelector('.folder-unlock').innerText",
      ),
      /No locking apps found/,
    );
  } else {
    assert.match(
      await native.evaluate(
        "document.querySelector('.folder-unlock').innerText",
      ),
      /Get PowerToys/,
    );
    const exited = once(locker, "exit");
    locker.kill();
    await exited;
  }
  await native.evaluate(
    "document.querySelector('dialog .button.primary').click()",
  );
  for (
    let i = 0;
    i < 60 &&
    (await native.evaluate("Boolean(document.querySelector('dialog[open]'))"));
    i++
  )
    await pause(100);
  assert.equal(
    await native.evaluate("Boolean(document.querySelector('dialog[open]'))"),
    false,
  );
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
  const centering = await native.evaluate(
    "(() => {const area=document.querySelector('.setup-main').getBoundingClientRect(),first=document.querySelector('.setup-mark').getBoundingClientRect(),last=document.querySelector('.setup-location').getBoundingClientRect();return {above:first.top-area.top,below:area.bottom-last.bottom}})()",
  );
  assert.ok(
    Math.abs(centering.above - centering.below) < 2,
    JSON.stringify(centering),
  );
  await screenshot(native, "setup-welcome");
  await native.evaluate(
    "document.querySelector('.setup-action button').click()",
  );
  for (
    let i = 0;
    i < 120 &&
    !(await native.evaluate(
      "document.querySelector('.setup-copy h1')?.textContent==='Cloak is ready'",
    ));
    i++
  )
    await pause(250);
  assert.equal(
    await native.evaluate(
      "document.querySelector('.setup-copy h1')?.textContent",
    ),
    "Cloak is ready",
    await native.evaluate("document.body.innerText"),
  );
  await screenshot(native, "setup-ready");
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
  assert.match(output, /Reader/);
  assert.match(output, /Arcade/);
  const packagedCli = (...args) =>
    execFileSync(
      join(installation, "app", "Cloak.exe"),
      [join(installation, "app", "resources/app/dist/cli.cjs"), ...args],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: "pipe",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          CLOAK_DATA_DIR: profile,
          CLOAK_SCRIPTS_DIR: join(installation, "app", "resources/app/scripts"),
        },
      },
    );
  assert.match(packagedCli("cleanup"), /Recovery cleanup complete/);
  assert.throws(
    () => packagedCli("add", broken, "--confirm"),
    (error) => /Use latest remote version/.test(String(error.stderr)),
  );
  assert.throws(
    () =>
      packagedCli(
        "add",
        broken,
        "--confirm",
        "--use-remote-version",
        "--repository",
        "invalid-url",
      ),
    (error) => /Use a GitHub repository URL/.test(String(error.stderr)),
  );
  assert.equal(await readFile(join(broken, ".git", "index"), "utf8"), "");
  if (installLocal) {
    const registration = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Cloak' | Select-Object DisplayVersion,InstallLocation | ConvertTo-Json -Compress",
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    assert.equal(registration.DisplayVersion, version);
    assert.equal(registration.InstallLocation, join(installation, "app"));
    const integration = JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$taskStart = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cloak\\Cloak.lnk'; $taskShell = New-Object -ComObject WScript.Shell; @{Target=$taskShell.CreateShortcut($taskStart).TargetPath; Path=[Environment]::GetEnvironmentVariable('Path','User')} | ConvertTo-Json -Compress",
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    assert.equal(integration.Target, join(installation, "app", "Cloak.exe"));
    assert.ok(
      integration.Path.split(";").some(
        (path) =>
          path.toLowerCase() === join(installation, "app").toLowerCase(),
      ),
    );
    console.log(
      "Per-user Windows install, uninstall registration, Start menu shortcut and CLI PATH verified.",
    );
  }
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
