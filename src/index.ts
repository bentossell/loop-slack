import { App, type SlackCommandMiddlewareArgs, type AllMiddlewareArgs } from '@slack/bolt';
import { loadConfig, getConfig } from './config.js';
import * as db from './db.js';
import * as auth from './auth.js';
import * as github from './github.js';
import * as loop from './loop.js';
import * as views from './views.js';

// Load config first
const config = loadConfig();

// Initialize Slack app
const app = new App({
  token: config.slack.bot_token,
  appToken: config.slack.app_token,
  socketMode: true,
});

// ============================================================
// SLASH COMMANDS
// ============================================================

// /loop - main command
app.command('/loop', async ({ command, ack, respond, client }) => {
  await ack();
  
  const userId = command.user_id;
  const args = command.text.trim().split(/\s+/);
  const subcommand = args[0]?.toLowerCase() || 'status';
  
  switch (subcommand) {
    case 'start': {
      if (!auth.canStartLoop(userId)) {
        await respond(views.unauthorizedMessage('start loops'));
        return;
      }
      
      // Open modal for repo selection
      await client.views.open({
        trigger_id: command.trigger_id,
        view: views.startLoopModal(config.repos),
      });
      break;
    }
    
    case 'stop': {
      const loopId = args[1];
      if (!loopId) {
        // Stop all loops for this user? Or show picker?
        const activeLoops = db.getActiveLoops();
        if (activeLoops.length === 0) {
          await respond({ text: 'No active loops to stop.' });
          return;
        }
        
        if (activeLoops.length === 1) {
          if (!auth.canStopLoop(userId, activeLoops[0].started_by)) {
            await respond(views.unauthorizedMessage('stop this loop'));
            return;
          }
          loop.stopLoopProcess(activeLoops[0].id);
          await respond({ text: `⏹️ Stopped loop on \`${activeLoops[0].repo_owner}/${activeLoops[0].repo_name}\`` });
        } else {
          // TODO: show picker
          await respond({ text: `Multiple active loops. Specify ID: /loop stop <id>\n${activeLoops.map(l => `• ${l.id.slice(0, 8)} - ${l.repo_owner}/${l.repo_name}`).join('\n')}` });
        }
        return;
      }
      
      const targetLoop = db.getLoop(loopId) || db.getActiveLoops().find(l => l.id.startsWith(loopId));
      if (!targetLoop) {
        await respond({ text: `Loop not found: ${loopId}` });
        return;
      }
      
      if (!auth.canStopLoop(userId, targetLoop.started_by)) {
        await respond(views.unauthorizedMessage('stop this loop'));
        return;
      }
      
      loop.stopLoopProcess(targetLoop.id);
      await respond({ text: `⏹️ Stopped loop on \`${targetLoop.repo_owner}/${targetLoop.repo_name}\`` });
      break;
    }
    
    case 'status':
    default: {
      const activeLoops = db.getActiveLoops();
      const stats = db.getStats();
      await respond(views.statusMessage(activeLoops, stats));
      break;
    }
  }
});

// /task - create a task (GitHub issue)
app.command('/task', async ({ command, ack, respond, client }) => {
  await ack();
  
  const userId = command.user_id;
  
  if (!auth.canCreateTask(userId)) {
    await respond(views.unauthorizedMessage('create tasks'));
    return;
  }
  
  const text = command.text.trim();
  
  if (!text) {
    // Open modal
    await client.views.open({
      trigger_id: command.trigger_id,
      view: views.createTaskModal(config.repos),
    });
    return;
  }
  
  // Quick create: /task [repo] Title of task
  // If only one repo configured, use that
  if (config.repos.length === 1) {
    const repo = config.repos[0];
    const issue = await github.createIssue(repo.owner, repo.name, text);
    await respond(views.taskCreatedMessage(`${repo.owner}/${repo.name}`, issue));
    return;
  }
  
  // Try to parse repo from text
  const match = text.match(/^(\S+\/\S+)\s+(.+)$/);
  if (match) {
    const [, repoStr, title] = match;
    const [owner, name] = repoStr.split('/');
    const repo = config.repos.find(r => r.owner === owner && r.name === name);
    
    if (!repo) {
      await respond({ text: `Repo not configured: ${repoStr}` });
      return;
    }
    
    const issue = await github.createIssue(owner, name, title);
    await respond(views.taskCreatedMessage(repoStr, issue));
    return;
  }
  
  // Can't determine repo, open modal
  await client.views.open({
    trigger_id: command.trigger_id,
    view: views.createTaskModal(config.repos),
  });
});

// ============================================================
// MODAL SUBMISSIONS
// ============================================================

app.view('start_loop_modal', async ({ ack, body, view, client }) => {
  await ack();
  
  const userId = body.user.id;
  const values = view.state.values;
  
  const repoValue = values.repo_block.repo_select.selected_option?.value;
  const iterations = parseInt(values.iterations_block.iterations_input.value || '10', 10);
  const mode = values.mode_block.mode_select.selected_option?.value as 'auto' | 'approval';
  
  if (!repoValue) return;
  
  const [owner, name] = repoValue.split('/');
  const channelId = (body as any).response_urls?.[0]?.channel_id || (body as any).channel?.id;
  
  // Check concurrency
  const existingLoops = db.getLoopsForRepo(owner, name);
  if (existingLoops.length >= config.concurrency.max_per_repo) {
    // Can't DM from view submission easily, so we'll just proceed and log
    console.warn(`Repo ${owner}/${name} already has ${existingLoops.length} active loops`);
  }
  
  // Create loop
  const newLoop = db.createLoop({
    repo_owner: owner,
    repo_name: name,
    channel_id: channelId || '',
    started_by: userId,
    mode,
    iteration_max: iterations,
  });
  
  // Get issues for initial message
  const issues = await github.getOpenIssues(owner, name);
  
  // Post initial message
  let threadTs: string | undefined;
  if (channelId) {
    const result = await client.chat.postMessage({
      channel: channelId,
      ...views.loopStartedMessage(newLoop, issues),
    });
    threadTs = result.ts;
  }
  
  // Start the loop with callbacks
  startLoopWithCallbacks(newLoop.id, client, channelId, threadTs);
});

app.view('create_task_modal', async ({ ack, body, view, client }) => {
  await ack();
  
  const values = view.state.values;
  
  const repoValue = values.repo_block.repo_select.selected_option?.value;
  const title = values.title_block.title_input.value;
  const description = values.body_block.body_input?.value;
  
  if (!repoValue || !title) return;
  
  const [owner, name] = repoValue.split('/');
  
  const issue = await github.createIssue(owner, name, title, description || undefined);
  
  // Try to respond in channel
  const channelId = (body as any).response_urls?.[0]?.channel_id;
  if (channelId) {
    await client.chat.postMessage({
      channel: channelId,
      ...views.taskCreatedMessage(repoValue, issue),
    });
  }
});

// ============================================================
// BUTTON ACTIONS
// ============================================================

app.action('stop_loop', async ({ ack, body, client, action }) => {
  await ack();
  
  const userId = body.user.id;
  const loopId = (action as any).value;
  
  const targetLoop = db.getLoop(loopId);
  if (!targetLoop) return;
  
  if (!auth.canStopLoop(userId, targetLoop.started_by)) {
    await client.chat.postEphemeral({
      channel: (body as any).channel?.id || '',
      user: userId,
      text: "🚫 You don't have permission to stop this loop.",
    });
    return;
  }
  
  loop.stopLoopProcess(loopId);
  
  await client.chat.postMessage({
    channel: (body as any).channel?.id || '',
    thread_ts: (body as any).message?.thread_ts || (body as any).message?.ts,
    text: `⏹️ Loop stopped by <@${userId}>`,
  });
});

app.action('approve_loop', async ({ ack, body, client, action }) => {
  await ack();
  
  const userId = body.user.id;
  const loopId = (action as any).value;
  
  if (!auth.canApprove(userId)) {
    await client.chat.postEphemeral({
      channel: (body as any).channel?.id || '',
      user: userId,
      text: "🚫 You don't have permission to approve.",
    });
    return;
  }
  
  const targetLoop = db.getLoop(loopId);
  if (!targetLoop) return;
  
  await client.chat.postMessage({
    channel: (body as any).channel?.id || '',
    thread_ts: (body as any).message?.thread_ts || (body as any).message?.ts,
    text: `✅ Approved by <@${userId}> - merging and continuing...`,
  });
  
  await loop.approveAndContinue(loopId);
});

app.action('skip_loop', async ({ ack, body, client, action }) => {
  await ack();
  
  const userId = body.user.id;
  const loopId = (action as any).value;
  
  if (!auth.canApprove(userId)) {
    await client.chat.postEphemeral({
      channel: (body as any).channel?.id || '',
      user: userId,
      text: "🚫 You don't have permission to skip.",
    });
    return;
  }
  
  await client.chat.postMessage({
    channel: (body as any).channel?.id || '',
    thread_ts: (body as any).message?.thread_ts || (body as any).message?.ts,
    text: `⏭️ Skipped by <@${userId}> - continuing...`,
  });
  
  loop.skipAndContinue(loopId);
});

app.action('refresh_status', async ({ ack, body, client, respond }) => {
  await ack();
  
  const activeLoops = db.getActiveLoops();
  const stats = db.getStats();
  
  await respond(views.statusMessage(activeLoops, stats));
});

app.action('open_start_modal', async ({ ack, body, client }) => {
  await ack();
  
  await client.views.open({
    trigger_id: (body as any).trigger_id,
    view: views.startLoopModal(config.repos),
  });
});

app.action('open_task_modal', async ({ ack, body, client }) => {
  await ack();
  
  await client.views.open({
    trigger_id: (body as any).trigger_id,
    view: views.createTaskModal(config.repos),
  });
});

app.action('start_loop_for_repo', async ({ ack, body, client, action }) => {
  await ack();
  
  const userId = body.user.id;
  const repoValue = (action as any).value;
  
  if (!auth.canStartLoop(userId)) {
    await client.chat.postEphemeral({
      channel: (body as any).channel?.id || '',
      user: userId,
      text: "🚫 You don't have permission to start loops.",
    });
    return;
  }
  
  const [owner, name] = repoValue.split('/');
  const channelId = (body as any).channel?.id || '';
  
  const newLoop = db.createLoop({
    repo_owner: owner,
    repo_name: name,
    channel_id: channelId,
    started_by: userId,
    mode: 'auto',
    iteration_max: 10,
  });
  
  const issues = await github.getOpenIssues(owner, name);
  
  const result = await client.chat.postMessage({
    channel: channelId,
    ...views.loopStartedMessage(newLoop, issues),
  });
  
  startLoopWithCallbacks(newLoop.id, client, channelId, result.ts);
});

// Ignore select actions (used in modals)
app.action('select_repo', async ({ ack }) => { await ack(); });
app.action('repo_select', async ({ ack }) => { await ack(); });
app.action('iterations_input', async ({ ack }) => { await ack(); });
app.action('mode_select', async ({ ack }) => { await ack(); });

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function startLoopWithCallbacks(loopId: string, client: any, channelId: string, threadTs?: string) {
  loop.startLoop(loopId, {
    onStart: (l) => {
      db.startLoop(l.id, threadTs);
    },
    
    onIteration: async (l, iteration, output) => {
      // Extract a summary from output
      const summary = extractSummary(output);
      
      if (channelId && config.notifications.thread_updates) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          ...views.iterationUpdateMessage(l, iteration, summary),
        });
      }
    },
    
    onWaitingApproval: async (l, issueNumber, prNumber) => {
      const issue = issueNumber ? await github.getIssue(l.repo_owner, l.repo_name, issueNumber) : null;
      const pr = await github.getPR(l.repo_owner, l.repo_name, prNumber);
      
      if (channelId && pr) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          ...views.waitingApprovalMessage(l, issue, pr),
        });
      }
    },
    
    onComplete: async (l) => {
      if (channelId) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          ...views.loopCompleteMessage(l),
        });
      }
    },
    
    onError: async (l, error) => {
      if (channelId) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          ...views.loopErrorMessage(l, error),
        });
      }
    },
  }).catch(err => {
    console.error('Loop error:', err);
  });
}

function extractSummary(output: string): string {
  // Try to find meaningful info from droid output
  const lines = output.split('\n');
  
  // Look for file changes
  const fileChanges = lines.filter(l => l.match(/^[AMD]\s+\S+/) || l.includes('modified:') || l.includes('created:'));
  if (fileChanges.length > 0) {
    return `Files changed:\n${fileChanges.slice(0, 5).map(f => `\`${f.trim()}\``).join('\n')}`;
  }
  
  // Look for PR or issue references
  const prLine = lines.find(l => l.includes('pull/') || l.includes('PR #'));
  if (prLine) return prLine.trim();
  
  // Return last few non-empty lines
  const meaningful = lines.filter(l => l.trim().length > 0).slice(-3);
  return meaningful.join('\n') || 'Processing...';
}

// ============================================================
// START
// ============================================================

(async () => {
  await app.start();
  console.log('⚡️ Loop Slack bot is running!');
  console.log(`   Repos configured: ${config.repos.map(r => `${r.owner}/${r.name}`).join(', ')}`);
  console.log(`   Admins: ${config.auth.admins.length}`);
  console.log(`   Operators: ${config.auth.operators.length}`);
})();
