import { Octokit } from 'octokit';
import { getConfig, type Repo } from './config.js';

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    const config = getConfig();
    octokit = new Octokit({ auth: config.github.token });
  }
  return octokit;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  state: string;
  html_url: string;
  created_at: string;
}

export interface PR {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged: boolean;
}

export async function getOpenIssues(owner: string, repo: string): Promise<Issue[]> {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.listForRepo({
    owner,
    repo,
    state: 'open',
    per_page: 100,
  });
  
  // Filter out PRs (GitHub API returns PRs as issues too)
  return data
    .filter(issue => !issue.pull_request)
    .map(issue => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map(l => typeof l === 'string' ? l : l.name || ''),
      state: issue.state,
      html_url: issue.html_url,
      created_at: issue.created_at,
    }));
}

export async function getIssue(owner: string, repo: string, issueNumber: number): Promise<Issue | null> {
  const ok = getOctokit();
  try {
    const { data } = await ok.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      labels: data.labels.map(l => typeof l === 'string' ? l : l.name || ''),
      state: data.state,
      html_url: data.html_url,
      created_at: data.created_at,
    };
  } catch {
    return null;
  }
}

export async function createIssue(owner: string, repo: string, title: string, body?: string, labels?: string[]): Promise<Issue> {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.create({
    owner,
    repo,
    title,
    body: body || '',
    labels: labels || [],
  });
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    labels: data.labels.map(l => typeof l === 'string' ? l : l.name || ''),
    state: data.state,
    html_url: data.html_url,
    created_at: data.created_at,
  };
}

export async function commentOnIssue(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
  const ok = getOctokit();
  await ok.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

export async function closeIssue(owner: string, repo: string, issueNumber: number, comment?: string): Promise<void> {
  const ok = getOctokit();
  if (comment) {
    await commentOnIssue(owner, repo, issueNumber, comment);
  }
  await ok.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: 'closed',
  });
}

export async function getPR(owner: string, repo: string, prNumber: number): Promise<PR | null> {
  const ok = getOctokit();
  try {
    const { data } = await ok.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    return {
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
      merged: data.merged,
    };
  } catch {
    return null;
  }
}

export async function getOpenPRs(owner: string, repo: string): Promise<PR[]> {
  const ok = getOctokit();
  const { data } = await ok.rest.pulls.list({
    owner,
    repo,
    state: 'open',
  });
  return data.map(pr => ({
    number: pr.number,
    title: pr.title,
    html_url: pr.html_url,
    state: pr.state,
    merged: pr.merged || false,
  }));
}

export async function mergePR(owner: string, repo: string, prNumber: number): Promise<boolean> {
  const ok = getOctokit();
  try {
    await ok.rest.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
      merge_method: 'squash',
    });
    return true;
  } catch (e) {
    console.error('Failed to merge PR:', e);
    return false;
  }
}

export async function getRepoLabels(owner: string, repo: string): Promise<string[]> {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.listLabelsForRepo({
    owner,
    repo,
  });
  return data.map(l => l.name);
}

export function formatIssueList(issues: Issue[]): string {
  if (issues.length === 0) {
    return '_No open issues_';
  }
  return issues.map(i => {
    const labels = i.labels.length > 0 ? ` [${i.labels.join(', ')}]` : '';
    return `• #${i.number}: ${i.title}${labels}`;
  }).join('\n');
}
