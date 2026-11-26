// Agent Board prototype: a tiny local server that reads Orca through its CLI
// and serves one page shaped like an Orca right-sidebar panel.
// Run: node server.mjs   then open http://localhost:4870
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ORCA = process.env.ORCA_CLI_COMMAND || '/Applications/Orca.app/Contents/Resources/bin/orca';
const PORT = Number(process.env.PORT || 4870);
const HERE = dirname(fileURLToPath(import.meta.url));

function orca(args) {
  return new Promise((resolve) => {
    execFile(ORCA, [...args, '--json'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.ok === false) return resolve({ error: parsed.error?.message || 'orca error' });
        resolve({ result: parsed.result });
      } catch {
        resolve({ error: (stderr || err?.message || 'no output').trim().slice(0, 300) });
      }
    });
  });
}

// Hosts: this Mac plus every paired environment.
async function listHosts() {
  const envs = await orca(['environment', 'list']);
  const hosts = [{ env: 'local', label: 'Mac' }];
  for (const e of envs.result?.environments || []) hosts.push({ env: e.name, label: e.name });
  return hosts;
}

// Repo lists change rarely: cache them for a few minutes.
let repoCache = { at: 0, byHost: {} };
async function repos(hosts) {
  if (Date.now() - repoCache.at < 30 * 1000) return repoCache.byHost;
  const byHost = {};
  await Promise.all(hosts.map(async (h) => {
    const r = await orca(['repo', 'list', '--environment', h.env]);
    byHost[h.label] = r.result?.repos || [];
  }));
  repoCache = { at: Date.now(), byHost };
  return byHost;
}

// The floating workspace is not a worktree: `worktree ps` and `agent list` leave it out.
// Its open chat tabs are only in Orca's local session store, so read their ids there
// (read-only, this Mac only) and ask the CLI for each one with `agent show`.
const SESSION_DB = join(process.env.HOME, 'Library/Application Support/orca/agent-session-domain.db');
function sqlite(query) {
  return new Promise((resolve) => {
    execFile('sqlite3', ['-json', `file:${SESSION_DB}?mode=ro`, query], { timeout: 5000 }, (err, stdout) => {
      try { resolve(JSON.parse(stdout || '[]')); } catch { resolve([]); }
    });
  });
}
async function floatingWorkspace() {
  const rows = await sqlite(`select t.session_id as id, t.position as pos
    from agent_session_tabs t join agent_session_records r using(session_id)
    where json_extract(r.record_json,'$.location.workspaceId') = 'global-floating-terminal'`);
  const agents = (await Promise.all(rows.map(async (r) => {
    const s = await orca(['agent', 'show', r.id]);
    const p = s.result?.places?.[0];
    if (!p) return null;
    return {
      sessionId: r.id, kind: 'chat', agent: p.agent, state: p.state, outcome: null, interrupted: false,
      title: p.title, prompt: null, last: p.lastAssistantMessage || null, tool: null, subagents: 0,
      updatedAt: p.updatedAt || 0, unread: false, paneKey: p.paneKey,
    };
  }))).filter(Boolean).sort((x, y) => y.updatedAt - x.updatedAt);
  if (!agents.length) return null;
  return {
    id: 'Mac|global-floating-terminal', host: 'Mac', env: 'local', selector: null, floating: true,
    project: 'Mac:floating', repo: 'Floating', name: 'floating workspace', branch: '', path: '',
    kanban: null, unread: false, pinned: false, isMain: false, bot: null, cliCreated: false, provenance: null,
    liveTerminals: 0, prs: [], parentId: null, lastAt: agents[0].updatedAt, agents,
  };
}

function lastOf(w) {
  return Math.max(w.lastActivityAt || 0, ...(w.agents || []).map((a) => a.updatedAt || 0));
}

async function snapshot() {
  const hosts = await listHosts();
  const [repoByHost, psByHost] = await Promise.all([
    repos(hosts),
    Promise.all(hosts.map(async (h) => [h, await orca(['worktree', 'ps', '--limit', '10000', '--environment', h.env])])),
  ]);

  // Project identity: git remote when there is one, else host + path.
  const projectOf = new Map();
  const projectName = new Map();
  for (const [host, list] of Object.entries(repoByHost)) {
    for (const r of list) {
      const key = r.gitRemoteIdentity?.canonicalKey || `${host}:${r.path}`;
      projectOf.set(`${host}|${r.id}`, key);
      // A name the user set in Orca (differs from the folder) wins on any host; else the Mac's.
      const folder = r.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
      const custom = r.displayName && r.displayName !== folder;
      const prev = projectName.get(key);
      if (!prev || (custom && !prev.custom) || (host === 'Mac' && custom === !!prev.custom)) projectName.set(key, { name: r.displayName, custom });
    }
  }

  const errors = [];
  const workspaces = [];
  const index = new Map();
  for (const [h, ps] of psByHost) {
    if (ps.error) { errors.push(`${h.label}: ${ps.error}`); continue; }
    for (const w of ps.result.worktrees) {
      const id = `${h.label}|${w.worktreeId}`;
      const project = projectOf.get(`${h.label}|${w.repoId}`) || `${h.label}:${w.repo}`;
      if (!projectName.has(project)) projectName.set(project, w.repo);
      const ws = {
        id,
        host: h.label,
        env: w.address?.environment || h.env,
        selector: w.address?.worktree || `id:${w.worktreeId}`,
        project,
        repo: w.repo,
        name: w.displayName,
        branch: (w.branch || '').replace('refs/heads/', ''),
        path: w.path,
        kanban: w.workspaceStatus,
        unread: !!w.unread,
        pinned: !!w.isPinned,
        isMain: !!w.isMainWorktree,
        bot: w.bot || null,
        cliCreated: !!w.cliCreated,
        provenance: w.creatorProvenance?.kind || null,
        liveTerminals: w.liveTerminalCount || 0,
        prs: (w.linkedItems || []).filter((i) => i.type === 'pr').map((i) => ({ number: i.number, url: i.url })),
        parentRef: w.parent ? { host: w.parent.environment?.name === 'local' ? 'Mac' : w.parent.environment?.name, keys: [w.parent.selector, w.parent.address?.worktree] } : null,
        parentId: null,
        lastAt: lastOf(w),
        agents: (w.agents || []).map((a) => ({
          sessionId: a.orcaSessionId || null,
          kind: a.paneKey?.startsWith('structured-agent-session') ? 'chat' : 'terminal',
          agent: a.agentType,
          state: a.state,
          outcome: a.mainAgent?.outcome || null,
          interrupted: !!a.interrupted,
          title: a.conversationName || a.displayName || a.taskTitle || null,
          prompt: a.prompt || null,
          last: a.lastAssistantMessage || null,
          tool: a.toolName || null,
          subagents: (a.children || []).length,
          updatedAt: a.updatedAt || a.stateStartedAt || 0,
          unread: !!a.activity?.unread,
        })).sort((x, y) => y.updatedAt - x.updatedAt),
      };
      workspaces.push(ws);
      for (const k of [w.worktreeId, `id:${w.worktreeId}`, w.identity?.key, w.identity?.key && `identity:${w.identity.key}`]) {
        if (k) index.set(`${h.label}|${k}`, id);
      }
    }
  }
  for (const ws of workspaces) {
    if (!ws.parentRef) continue;
    for (const k of ws.parentRef.keys) {
      const hit = k && index.get(`${ws.parentRef.host}|${k}`);
      if (hit) { ws.parentId = hit; break; }
    }
    ws.parentMissing = !ws.parentId;
    delete ws.parentRef;
  }
  const floating = await floatingWorkspace();
  if (floating) { workspaces.push(floating); projectName.set(floating.project, 'Floating workspace'); }
  return {
    at: Date.now(),
    hosts: hosts.map((h) => h.label),
    projects: Object.fromEntries([...projectName].map(([k, v]) => [k, typeof v === 'string' ? v : v.name])),
    workspaces,
    errors,
  };
}

async function body(req) {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
}

createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(await readFile(join(HERE, 'index.html')));
    }
    if (req.url === '/api/snapshot') {
      const t = Date.now();
      const data = await snapshot();
      data.tookMs = Date.now() - t;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(data));
    }
    if (req.url === '/api/open' && req.method === 'POST') {
      const { env, selector } = await body(req);
      if (!selector) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'the CLI cannot open the floating workspace; use its shortcut in Orca' }));
      }
      // `worktree activate --environment <server>` opens the workspace in that server's own window.
      // For another machine, switch THIS machine's window with `terminal switch --environment`: to one
      // of the workspace's terminals, else to a temporary terminal created for it and always closed
      // again (only that one). Success only when Orca says the window navigated.
      let r;
      let how;
      const remote = env !== 'local';
      const list = await orca(['terminal', 'list', '--environment', env, '--worktree', selector]);
      const terms = (list.result?.terminals || []).filter((t) => t.connected !== false && t.handle);
      const pick = terms.find((t) => t.agentIdentity) || terms[0];
      const switchHere = async (handle) => {
        const s = await orca(['terminal', 'switch', '--environment', env, '--terminal', handle]);
        if (s.error) return s;
        return s.result?.focus?.navigated === true ? s : { error: `Orca did not move this window to the ${env} workspace` };
      };
      if (remote) {
        if (pick) { r = await switchHere(pick.handle); how = 'terminal switch'; }
        else {
          how = 'temporary terminal';
          const made = await orca(['terminal', 'create', '--environment', env, '--worktree', selector, '--title', 'Agent Board']);
          const temp = made.result?.terminal?.handle;
          if (!temp) r = { error: made.error || 'Orca did not give a terminal handle' };
          else {
            try { r = await switchHere(temp); }
            finally { await orca(['terminal', 'close', '--environment', env, '--terminal', temp]); }
          }
        }
      } else {
        r = await orca(['worktree', 'activate', '--environment', env, '--worktree', selector]);
        how = 'worktree activate';
        if (r.error && pick) { r = await orca(['terminal', 'switch', '--environment', env, '--terminal', pick.handle]); how = 'terminal switch'; }
      }
      console.log(`open ${env} ${selector} via ${how}: ${r.error || 'ok'}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...r, how }));
    }
    res.writeHead(404); res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Agent Board prototype on http://localhost:${PORT}`));
