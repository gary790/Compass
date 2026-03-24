import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { githubConfig } from '../../config/index.js';

async function getOctokit() {
  const { Octokit } = await import('octokit');
  if (!githubConfig.token) throw new Error('GITHUB_TOKEN not configured in .env');
  return new Octokit({ auth: githubConfig.token });
}

// ============================================================
// GITHUB CREATE REPO
// ============================================================
toolRegistry.register(
  {
    name: 'github_create_repo',
    category: 'github',
    description: 'Create a new GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        private: { type: 'boolean', description: 'Make repository private', default: true },
        autoInit: { type: 'boolean', description: 'Initialize with README', default: false },
      },
      required: ['name'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({ name: z.string(), description: z.string().optional(), private: z.boolean().optional(), autoInit: z.boolean().optional() }),
  async (args) => {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.repos.createForAuthenticatedUser({
      name: args.name,
      description: args.description,
      private: args.private ?? true,
      auto_init: args.autoInit ?? false,
    });
    return { name: data.name, url: data.html_url, clone_url: data.clone_url, private: data.private };
  }
);

// ============================================================
// GITHUB LIST REPOS
// ============================================================
toolRegistry.register(
  {
    name: 'github_list_repos',
    category: 'github',
    description: 'List GitHub repositories for the authenticated user or an organization.',
    parameters: {
      type: 'object',
      properties: {
        org: { type: 'string', description: 'Organization name (optional, defaults to user repos)' },
        sort: { type: 'string', enum: ['updated', 'created', 'pushed', 'full_name'], default: 'updated' },
        perPage: { type: 'number', description: 'Results per page', default: 10 },
      },
    },
    riskLevel: 'safe',
  },
  z.object({ org: z.string().optional(), sort: z.string().optional(), perPage: z.number().optional() }),
  async (args) => {
    const octokit = await getOctokit();
    let repos;

    if (args.org) {
      const { data } = await octokit.rest.repos.listForOrg({
        org: args.org,
        sort: (args.sort || 'updated') as any,
        per_page: args.perPage || 10,
      });
      repos = data;
    } else {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: (args.sort || 'updated') as any,
        per_page: args.perPage || 10,
      });
      repos = data;
    }

    return {
      repos: repos.map(r => ({
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        description: r.description,
        private: r.private,
        language: r.language,
        updatedAt: r.updated_at,
        stars: r.stargazers_count,
      })),
      count: repos.length,
    };
  }
);

// ============================================================
// GITHUB READ FILE
// ============================================================
toolRegistry.register(
  {
    name: 'github_read_file',
    category: 'github',
    description: 'Read a file from a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path in the repo' },
        ref: { type: 'string', description: 'Branch or commit SHA (default: main)' },
      },
      required: ['owner', 'repo', 'path'],
    },
    riskLevel: 'safe',
  },
  z.object({ owner: z.string(), repo: z.string(), path: z.string(), ref: z.string().optional() }),
  async (args) => {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.repos.getContent({
      owner: args.owner,
      repo: args.repo,
      path: args.path,
      ref: args.ref,
    }) as { data: any };

    if (data.type === 'file') {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return { path: data.path, content, size: data.size, sha: data.sha };
    }

    // Directory listing
    return {
      path: args.path,
      type: 'directory',
      items: Array.isArray(data) ? data.map((f: any) => ({ name: f.name, type: f.type, size: f.size })) : [],
    };
  }
);

// ============================================================
// GITHUB EDIT FILE (create or update)
// ============================================================
toolRegistry.register(
  {
    name: 'github_edit_file',
    category: 'github',
    description: 'Create or update a file in a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        path: { type: 'string', description: 'File path in the repo' },
        content: { type: 'string', description: 'New file content' },
        message: { type: 'string', description: 'Commit message' },
        branch: { type: 'string', description: 'Branch name (default: main)' },
        sha: { type: 'string', description: 'SHA of file being replaced (required for updates)' },
      },
      required: ['owner', 'repo', 'path', 'content', 'message'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({
    owner: z.string(), repo: z.string(), path: z.string(),
    content: z.string(), message: z.string(), branch: z.string().optional(), sha: z.string().optional(),
  }),
  async (args) => {
    const octokit = await getOctokit();
    const params: any = {
      owner: args.owner,
      repo: args.repo,
      path: args.path,
      message: args.message,
      content: Buffer.from(args.content).toString('base64'),
      branch: args.branch || 'main',
    };
    if (args.sha) params.sha = args.sha;

    const { data } = await octokit.rest.repos.createOrUpdateFileContents(params);
    return { path: args.path, sha: data.content?.sha, commitSha: data.commit.sha, url: data.content?.html_url };
  }
);

// ============================================================
// GITHUB CREATE PR
// ============================================================
toolRegistry.register(
  {
    name: 'github_create_pr',
    category: 'github',
    description: 'Create a pull request on GitHub.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'PR title' },
        body: { type: 'string', description: 'PR description' },
        head: { type: 'string', description: 'Source branch' },
        base: { type: 'string', description: 'Target branch', default: 'main' },
      },
      required: ['owner', 'repo', 'title', 'head'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
  },
  z.object({
    owner: z.string(), repo: z.string(), title: z.string(),
    body: z.string().optional(), head: z.string(), base: z.string().optional(),
  }),
  async (args) => {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.pulls.create({
      owner: args.owner,
      repo: args.repo,
      title: args.title,
      body: args.body || '',
      head: args.head,
      base: args.base || 'main',
    });
    return { number: data.number, url: data.html_url, state: data.state };
  }
);

// ============================================================
// GITHUB LIST ISSUES
// ============================================================
toolRegistry.register(
  {
    name: 'github_list_issues',
    category: 'github',
    description: 'List issues from a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        perPage: { type: 'number', default: 10 },
      },
      required: ['owner', 'repo'],
    },
    riskLevel: 'safe',
  },
  z.object({ owner: z.string(), repo: z.string(), state: z.string().optional(), perPage: z.number().optional() }),
  async (args) => {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.issues.listForRepo({
      owner: args.owner,
      repo: args.repo,
      state: (args.state || 'open') as any,
      per_page: args.perPage || 10,
    });
    return {
      issues: data.map(i => ({
        number: i.number,
        title: i.title,
        state: i.state,
        labels: i.labels.map((l: any) => l.name),
        author: i.user?.login,
        createdAt: i.created_at,
        url: i.html_url,
      })),
      count: data.length,
    };
  }
);

export default toolRegistry;
