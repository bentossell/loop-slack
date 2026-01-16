import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { randomUUID } from 'crypto';

const db: DatabaseType = new Database('loop-slack.db');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS loops (
    id TEXT PRIMARY KEY,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    thread_ts TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    mode TEXT NOT NULL DEFAULT 'auto',
    current_issue INTEGER,
    current_pr INTEGER,
    iteration_current INTEGER DEFAULT 0,
    iteration_max INTEGER DEFAULT 10,
    started_at TEXT,
    started_by TEXT NOT NULL,
    completed_at TEXT,
    error TEXT,
    pid INTEGER
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    loop_id TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    pr_number INTEGER,
    started_at TEXT,
    completed_at TEXT,
    error TEXT,
    FOREIGN KEY (loop_id) REFERENCES loops(id)
  );

  CREATE TABLE IF NOT EXISTS loop_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loop_id TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    level TEXT DEFAULT 'info',
    message TEXT NOT NULL,
    data TEXT,
    FOREIGN KEY (loop_id) REFERENCES loops(id)
  );

  CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status);
  CREATE INDEX IF NOT EXISTS idx_loops_repo ON loops(repo_owner, repo_name);
  CREATE INDEX IF NOT EXISTS idx_tasks_loop ON tasks(loop_id);
  CREATE INDEX IF NOT EXISTS idx_logs_loop ON loop_logs(loop_id);
`);

export type LoopStatus = 'pending' | 'running' | 'paused' | 'waiting_approval' | 'complete' | 'error' | 'stopped';
export type LoopMode = 'auto' | 'approval';
export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'skipped' | 'error';

export interface Loop {
  id: string;
  repo_owner: string;
  repo_name: string;
  channel_id: string;
  thread_ts: string | null;
  status: LoopStatus;
  mode: LoopMode;
  current_issue: number | null;
  current_pr: number | null;
  iteration_current: number;
  iteration_max: number;
  started_at: string | null;
  started_by: string;
  completed_at: string | null;
  error: string | null;
  pid: number | null;
}

export interface Task {
  id: string;
  loop_id: string;
  issue_number: number;
  status: TaskStatus;
  pr_number: number | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

// Loop operations
export function createLoop(data: {
  repo_owner: string;
  repo_name: string;
  channel_id: string;
  started_by: string;
  mode?: LoopMode;
  iteration_max?: number;
}): Loop {
  const id = randomUUID();
  const stmt = db.prepare(`
    INSERT INTO loops (id, repo_owner, repo_name, channel_id, started_by, mode, iteration_max, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `);
  stmt.run(id, data.repo_owner, data.repo_name, data.channel_id, data.started_by, data.mode || 'auto', data.iteration_max || 10);
  return getLoop(id)!;
}

export function getLoop(id: string): Loop | null {
  const stmt = db.prepare('SELECT * FROM loops WHERE id = ?');
  return stmt.get(id) as Loop | null;
}

export function getActiveLoops(): Loop[] {
  const stmt = db.prepare(`SELECT * FROM loops WHERE status IN ('pending', 'running', 'paused', 'waiting_approval')`);
  return stmt.all() as Loop[];
}

export function getLoopsForRepo(owner: string, name: string): Loop[] {
  const stmt = db.prepare(`SELECT * FROM loops WHERE repo_owner = ? AND repo_name = ? AND status IN ('pending', 'running', 'paused', 'waiting_approval')`);
  return stmt.all(owner, name) as Loop[];
}

export function getRecentLoops(limit = 10): Loop[] {
  const stmt = db.prepare(`SELECT * FROM loops ORDER BY started_at DESC LIMIT ?`);
  return stmt.all(limit) as Loop[];
}

export function updateLoop(id: string, updates: Partial<Loop>): void {
  const fields = Object.keys(updates).filter(k => k !== 'id');
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => (updates as any)[f]);
  
  const stmt = db.prepare(`UPDATE loops SET ${setClause} WHERE id = ?`);
  stmt.run(...values, id);
}

export function startLoop(id: string, threadTs?: string): void {
  updateLoop(id, {
    status: 'running',
    started_at: new Date().toISOString(),
    thread_ts: threadTs || null,
  });
}

export function completeLoop(id: string): void {
  updateLoop(id, {
    status: 'complete',
    completed_at: new Date().toISOString(),
  });
}

export function failLoop(id: string, error: string): void {
  updateLoop(id, {
    status: 'error',
    error,
    completed_at: new Date().toISOString(),
  });
}

export function stopLoop(id: string): void {
  updateLoop(id, {
    status: 'stopped',
    completed_at: new Date().toISOString(),
  });
}

// Task operations
export function createTask(loopId: string, issueNumber: number): Task {
  const id = randomUUID();
  const stmt = db.prepare(`
    INSERT INTO tasks (id, loop_id, issue_number, status)
    VALUES (?, ?, ?, 'pending')
  `);
  stmt.run(id, loopId, issueNumber);
  return getTask(id)!;
}

export function getTask(id: string): Task | null {
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  return stmt.get(id) as Task | null;
}

export function getTasksForLoop(loopId: string): Task[] {
  const stmt = db.prepare('SELECT * FROM tasks WHERE loop_id = ? ORDER BY started_at');
  return stmt.all(loopId) as Task[];
}

export function updateTask(id: string, updates: Partial<Task>): void {
  const fields = Object.keys(updates).filter(k => k !== 'id');
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => (updates as any)[f]);
  
  const stmt = db.prepare(`UPDATE tasks SET ${setClause} WHERE id = ?`);
  stmt.run(...values, id);
}

// Logging
export function logLoop(loopId: string, message: string, level: 'info' | 'warn' | 'error' = 'info', data?: any): void {
  const stmt = db.prepare(`
    INSERT INTO loop_logs (loop_id, level, message, data)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(loopId, level, message, data ? JSON.stringify(data) : null);
}

export function getLoopLogs(loopId: string, limit = 50): { timestamp: string; level: string; message: string; data: any }[] {
  const stmt = db.prepare('SELECT timestamp, level, message, data FROM loop_logs WHERE loop_id = ? ORDER BY timestamp DESC LIMIT ?');
  const rows = stmt.all(loopId, limit) as any[];
  return rows.map(r => ({
    ...r,
    data: r.data ? JSON.parse(r.data) : null,
  }));
}

// Stats
export function getStats(): { active: number; completed_today: number; total: number } {
  const active = (db.prepare(`SELECT COUNT(*) as count FROM loops WHERE status IN ('pending', 'running', 'paused', 'waiting_approval')`).get() as any).count;
  const today = new Date().toISOString().split('T')[0];
  const completed_today = (db.prepare(`SELECT COUNT(*) as count FROM loops WHERE status = 'complete' AND date(completed_at) = ?`).get(today) as any).count;
  const total = (db.prepare('SELECT COUNT(*) as count FROM loops').get() as any).count;
  return { active, completed_today, total };
}

export { db };
