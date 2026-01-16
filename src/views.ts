import type { Loop } from './db.js';
import type { Issue, PR } from './github.js';
import type { Repo } from './config.js';

export function repoPickerBlocks(repos: Repo[], actionId = 'select_repo') {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Select a repository:*',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'static_select',
          placeholder: {
            type: 'plain_text',
            text: 'Choose a repo',
          },
          action_id: actionId,
          options: repos.map(r => ({
            text: {
              type: 'plain_text',
              text: `${r.owner}/${r.name}`,
            },
            value: `${r.owner}/${r.name}`,
          })),
        },
      ],
    },
  ];
}

export function startLoopModal(repos: Repo[]) {
  return {
    type: 'modal' as const,
    callback_id: 'start_loop_modal',
    title: {
      type: 'plain_text' as const,
      text: 'Start Loop',
    },
    submit: {
      type: 'plain_text' as const,
      text: 'Start',
    },
    close: {
      type: 'plain_text' as const,
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'repo_block',
        element: {
          type: 'static_select',
          action_id: 'repo_select',
          placeholder: {
            type: 'plain_text',
            text: 'Select repository',
          },
          options: repos.map(r => ({
            text: {
              type: 'plain_text',
              text: `${r.owner}/${r.name}`,
            },
            value: `${r.owner}/${r.name}`,
          })),
        },
        label: {
          type: 'plain_text',
          text: 'Repository',
        },
      },
      {
        type: 'input',
        block_id: 'iterations_block',
        element: {
          type: 'plain_text_input',
          action_id: 'iterations_input',
          initial_value: '10',
          placeholder: {
            type: 'plain_text',
            text: 'Number of iterations',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Max Iterations',
        },
      },
      {
        type: 'input',
        block_id: 'mode_block',
        element: {
          type: 'radio_buttons',
          action_id: 'mode_select',
          initial_option: {
            text: {
              type: 'plain_text',
              text: 'Auto - runs until complete',
            },
            value: 'auto',
          },
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'Auto - runs until complete',
              },
              value: 'auto',
            },
            {
              text: {
                type: 'plain_text',
                text: 'Approval - pauses after each task',
              },
              value: 'approval',
            },
          ],
        },
        label: {
          type: 'plain_text',
          text: 'Mode',
        },
      },
    ],
  };
}

export function createTaskModal(repos: Repo[]) {
  return {
    type: 'modal' as const,
    callback_id: 'create_task_modal',
    title: {
      type: 'plain_text' as const,
      text: 'Create Task',
    },
    submit: {
      type: 'plain_text' as const,
      text: 'Create',
    },
    close: {
      type: 'plain_text' as const,
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'repo_block',
        element: {
          type: 'static_select',
          action_id: 'repo_select',
          placeholder: {
            type: 'plain_text',
            text: 'Select repository',
          },
          options: repos.map(r => ({
            text: {
              type: 'plain_text',
              text: `${r.owner}/${r.name}`,
            },
            value: `${r.owner}/${r.name}`,
          })),
        },
        label: {
          type: 'plain_text',
          text: 'Repository',
        },
      },
      {
        type: 'input',
        block_id: 'title_block',
        element: {
          type: 'plain_text_input',
          action_id: 'title_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., Add dark mode to settings',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Title',
        },
      },
      {
        type: 'input',
        block_id: 'body_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'body_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Detailed description, requirements, files to change...',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Description',
        },
      },
    ],
  };
}

export function loopStartedMessage(loop: Loop, issues: Issue[]) {
  const issueList = issues.length > 0 
    ? issues.slice(0, 5).map(i => `• #${i.number}: ${i.title}`).join('\n')
    : '_No open issues found_';
  
  return {
    text: `🚀 Loop started on ${loop.repo_owner}/${loop.repo_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚀 *Loop started* on \`${loop.repo_owner}/${loop.repo_name}\`\n\nMode: ${loop.mode === 'approval' ? '✋ Approval' : '🤖 Auto'} • Max iterations: ${loop.iteration_max}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Open issues:*\n${issueList}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '⏹️ Stop',
            },
            style: 'danger',
            action_id: 'stop_loop',
            value: loop.id,
          },
        ],
      },
    ],
  };
}

export function iterationUpdateMessage(loop: Loop, iteration: number, summary: string) {
  return {
    text: `Iteration ${iteration}/${loop.iteration_max}`,
    blocks: [
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `🔄 *Iteration ${iteration}/${loop.iteration_max}*`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: summary.length > 500 ? summary.slice(0, 500) + '...' : summary,
        },
      },
    ],
  };
}

export function waitingApprovalMessage(loop: Loop, issue: Issue | null, pr: PR) {
  return {
    text: `✅ Task complete - waiting for approval`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Task complete${issue ? `: ${issue.title}` : ''}*\n\nPR <${pr.html_url}|#${pr.number}> is ready for review.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '✅ Approve & Continue',
            },
            style: 'primary',
            action_id: 'approve_loop',
            value: loop.id,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '⏭️ Skip',
            },
            action_id: 'skip_loop',
            value: loop.id,
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '⏹️ Stop',
            },
            style: 'danger',
            action_id: 'stop_loop',
            value: loop.id,
          },
        ],
      },
    ],
  };
}

export function loopCompleteMessage(loop: Loop) {
  return {
    text: `🎉 Loop complete`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🎉 *Loop complete* on \`${loop.repo_owner}/${loop.repo_name}\`\n\nCompleted ${loop.iteration_current} iteration${loop.iteration_current === 1 ? '' : 's'}.`,
        },
      },
    ],
  };
}

export function loopErrorMessage(loop: Loop, error: string) {
  return {
    text: `❌ Loop error`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ *Loop error* on \`${loop.repo_owner}/${loop.repo_name}\`\n\n\`\`\`${error.slice(0, 500)}\`\`\``,
        },
      },
    ],
  };
}

export function statusMessage(activeLoops: Loop[], stats: { active: number; completed_today: number; total: number }) {
  const activeSection = activeLoops.length > 0
    ? activeLoops.map(l => {
        const status = l.status === 'waiting_approval' ? '✋ Waiting approval' : '🔄 Running';
        return `• \`${l.repo_owner}/${l.repo_name}\` - ${status} (${l.iteration_current}/${l.iteration_max})`;
      }).join('\n')
    : '_No active loops_';

  return {
    text: '📊 Loop Status',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 Loop Status',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Active:* ${stats.active} • *Completed today:* ${stats.completed_today} • *Total:* ${stats.total}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Active loops:*\n${activeSection}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔄 Refresh',
            },
            action_id: 'refresh_status',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '➕ Start Loop',
            },
            action_id: 'open_start_modal',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📝 Create Task',
            },
            action_id: 'open_task_modal',
          },
        ],
      },
    ],
  };
}

export function taskCreatedMessage(repo: string, issue: Issue) {
  return {
    text: `📝 Task created: ${issue.title}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📝 *Task created* in \`${repo}\`\n\n<${issue.html_url}|#${issue.number}: ${issue.title}>`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🚀 Start Loop Now',
            },
            action_id: 'start_loop_for_repo',
            value: repo,
          },
        ],
      },
    ],
  };
}

export function unauthorizedMessage(action: string) {
  return {
    text: `🚫 You don't have permission to ${action}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🚫 You don't have permission to *${action}*.\n\nAsk an admin to add you to the config.`,
        },
      },
    ],
  };
}
