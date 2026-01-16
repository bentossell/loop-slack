import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import type { WebClient } from '@slack/web-api';
import * as db from './db.js';
import { getConfig, getFactoryKey, getRepo } from './config.js';
import * as github from './github.js';

const WORKSPACE_DIR = './workspaces';
const activeProcesses = new Map<string, ChildProcess>();

interface LoopCallbacks {
  onStart?: (loop: db.Loop) => void;
  onIteration?: (loop: db.Loop, iteration: number, output: string) => void;
  onTaskComplete?: (loop: db.Loop, issueNumber: number, prNumber?: number) => void;
  onWaitingApproval?: (loop: db.Loop, issueNumber: number, prNumber: number) => void;
  onComplete?: (loop: db.Loop) => void;
  onError?: (loop: db.Loop, error: string) => void;
}

export async function startLoop(loopId: string, callbacks: LoopCallbacks = {}): Promise<void> {
  const loop = db.getLoop(loopId);
  if (!loop) throw new Error(`Loop not found: ${loopId}`);
  
  const config = getConfig();
  const repoConfig = getRepo(loop.repo_owner, loop.repo_name);
  if (!repoConfig) throw new Error(`Repo not configured: ${loop.repo_owner}/${loop.repo_name}`);
  
  const factoryKey = getFactoryKey(loop.started_by);
  if (!factoryKey) throw new Error(`No Factory API key for user ${loop.started_by}`);
  
  // Set up workspace
  const workspaceDir = join(WORKSPACE_DIR, `${loop.repo_owner}-${loop.repo_name}`);
  await ensureWorkspace(workspaceDir, loop.repo_owner, loop.repo_name, repoConfig.default_branch);
  
  // Mark as running
  db.updateLoop(loopId, { status: 'running', started_at: new Date().toISOString() });
  db.logLoop(loopId, 'Loop started');
  callbacks.onStart?.(db.getLoop(loopId)!);
  
  // Run iterations
  for (let i = 1; i <= loop.iteration_max; i++) {
    const currentLoop = db.getLoop(loopId)!;
    
    // Check if stopped
    if (currentLoop.status === 'stopped') {
      db.logLoop(loopId, 'Loop stopped by user');
      break;
    }
    
    // Check if paused/waiting
    if (currentLoop.status === 'paused' || currentLoop.status === 'waiting_approval') {
      db.logLoop(loopId, `Loop paused (status: ${currentLoop.status})`);
      break;
    }
    
    db.updateLoop(loopId, { iteration_current: i });
    db.logLoop(loopId, `Starting iteration ${i}/${loop.iteration_max}`);
    
    try {
      const result = await runIteration(loopId, workspaceDir, factoryKey, repoConfig.prompt_path);
      callbacks.onIteration?.(db.getLoop(loopId)!, i, result.output);
      
      // Parse result
      if (result.output.includes('<done>COMPLETE</done>') || result.output.includes('<done>NO_TASKS</done>')) {
        db.completeLoop(loopId);
        db.logLoop(loopId, 'All tasks complete');
        callbacks.onComplete?.(db.getLoop(loopId)!);
        return;
      }
      
      // Check for PR creation
      const prMatch = result.output.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
      if (prMatch) {
        const prNumber = parseInt(prMatch[1], 10);
        const issueMatch = result.output.match(/#(\d+)/);
        const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : null;
        
        db.updateLoop(loopId, { current_pr: prNumber, current_issue: issueNumber });
        
        if (loop.mode === 'approval') {
          db.updateLoop(loopId, { status: 'waiting_approval' });
          db.logLoop(loopId, `Waiting for approval on PR #${prNumber}`);
          callbacks.onWaitingApproval?.(db.getLoop(loopId)!, issueNumber || 0, prNumber);
          return;
        }
        
        callbacks.onTaskComplete?.(db.getLoop(loopId)!, issueNumber || 0, prNumber);
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      db.failLoop(loopId, errorMsg);
      db.logLoop(loopId, `Error: ${errorMsg}`, 'error');
      callbacks.onError?.(db.getLoop(loopId)!, errorMsg);
      return;
    }
  }
  
  // Reached max iterations
  const finalLoop = db.getLoop(loopId)!;
  if (finalLoop.status === 'running') {
    db.completeLoop(loopId);
    db.logLoop(loopId, `Reached iteration limit (${loop.iteration_max})`);
    callbacks.onComplete?.(db.getLoop(loopId)!);
  }
}

async function ensureWorkspace(dir: string, owner: string, repo: string, branch: string): Promise<void> {
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
  }
  
  if (!existsSync(dir)) {
    // Clone repo
    await execCommand(`git clone https://github.com/${owner}/${repo}.git ${dir}`);
  } else {
    // Pull latest
    await execCommand(`git fetch origin && git reset --hard origin/${branch}`, { cwd: dir });
  }
}

async function runIteration(loopId: string, workspaceDir: string, factoryKey: string, promptPath: string): Promise<{ output: string }> {
  return new Promise((resolve, reject) => {
    const output: string[] = [];
    
    const proc = spawn('droid', ['exec', '--auto', 'high', '-f', promptPath], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        FACTORY_API_KEY: factoryKey,
      },
    });
    
    activeProcesses.set(loopId, proc);
    
    proc.stdout?.on('data', (data) => {
      output.push(data.toString());
    });
    
    proc.stderr?.on('data', (data) => {
      output.push(data.toString());
    });
    
    proc.on('close', (code) => {
      activeProcesses.delete(loopId);
      const fullOutput = output.join('');
      
      if (code === 0 || fullOutput.includes('<done>')) {
        resolve({ output: fullOutput });
      } else {
        reject(new Error(`Droid exited with code ${code}: ${fullOutput.slice(-500)}`));
      }
    });
    
    proc.on('error', (err) => {
      activeProcesses.delete(loopId);
      reject(err);
    });
  });
}

function execCommand(cmd: string, options?: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', cmd], { cwd: options?.cwd });
    const output: string[] = [];
    
    proc.stdout?.on('data', (data) => output.push(data.toString()));
    proc.stderr?.on('data', (data) => output.push(data.toString()));
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output.join(''));
      } else {
        reject(new Error(`Command failed: ${cmd}\n${output.join('')}`));
      }
    });
  });
}

export function stopLoopProcess(loopId: string): boolean {
  const proc = activeProcesses.get(loopId);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(loopId);
    db.stopLoop(loopId);
    return true;
  }
  
  // Maybe not actively running but in DB
  const loop = db.getLoop(loopId);
  if (loop && ['running', 'pending', 'paused', 'waiting_approval'].includes(loop.status)) {
    db.stopLoop(loopId);
    return true;
  }
  
  return false;
}

export async function approveAndContinue(loopId: string): Promise<void> {
  const loop = db.getLoop(loopId);
  if (!loop || loop.status !== 'waiting_approval') {
    throw new Error('Loop is not waiting for approval');
  }
  
  // Merge the PR if there is one
  if (loop.current_pr) {
    const merged = await github.mergePR(loop.repo_owner, loop.repo_name, loop.current_pr);
    if (!merged) {
      throw new Error(`Failed to merge PR #${loop.current_pr}`);
    }
    db.logLoop(loopId, `Merged PR #${loop.current_pr}`);
  }
  
  // Continue the loop
  db.updateLoop(loopId, { 
    status: 'running', 
    current_pr: null, 
    current_issue: null 
  });
  
  // Restart loop execution (fire and forget)
  startLoop(loopId).catch(err => {
    console.error('Error continuing loop:', err);
  });
}

export function skipAndContinue(loopId: string): void {
  const loop = db.getLoop(loopId);
  if (!loop || loop.status !== 'waiting_approval') {
    throw new Error('Loop is not waiting for approval');
  }
  
  db.updateLoop(loopId, { 
    status: 'running', 
    current_pr: null, 
    current_issue: null 
  });
  db.logLoop(loopId, `Skipped PR #${loop.current_pr}`);
  
  // Continue
  startLoop(loopId).catch(err => {
    console.error('Error continuing loop:', err);
  });
}

export function getActiveProcessCount(): number {
  return activeProcesses.size;
}
