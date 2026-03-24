import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import { deployConfig } from '../../config/index.js';

const execAsync = promisify(exec);

// ============================================================
// DEPLOY TO CLOUDFLARE PAGES
// ============================================================
toolRegistry.register(
  {
    name: 'deploy_cloudflare',
    category: 'deploy',
    description: 'Deploy a workspace project to Cloudflare Pages. Builds the project and deploys the dist directory.',
    parameters: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'Cloudflare Pages project name' },
        distDir: { type: 'string', description: 'Build output directory', default: 'dist' },
        buildCommand: { type: 'string', description: 'Build command to run first' },
        branch: { type: 'string', description: 'Branch name for deployment', default: 'main' },
      },
      required: ['projectName'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
    timeout: 120000,
  },
  z.object({ projectName: z.string(), distDir: z.string().optional(), buildCommand: z.string().optional(), branch: z.string().optional() }),
  async (args, ctx) => {
    if (!deployConfig.cloudflare.apiToken) {
      throw new Error('CLOUDFLARE_API_TOKEN not configured in .env');
    }

    const steps: { step: string; output: string; success: boolean }[] = [];

    // Step 1: Build
    if (args.buildCommand) {
      try {
        const { stdout, stderr } = await execAsync(args.buildCommand, {
          cwd: ctx.workspacePath,
          timeout: 60000,
          env: { ...process.env, CLOUDFLARE_API_TOKEN: deployConfig.cloudflare.apiToken },
        });
        steps.push({ step: 'build', output: (stdout + stderr).substring(0, 2000), success: true });
      } catch (error: any) {
        steps.push({ step: 'build', output: error.message, success: false });
        return { success: false, steps, error: 'Build failed' };
      }
    }

    // Step 2: Create project (if doesn't exist)
    try {
      await execAsync(
        `npx wrangler pages project create ${args.projectName} --production-branch ${args.branch || 'main'} 2>&1 || true`,
        {
          cwd: ctx.workspacePath,
          timeout: 30000,
          env: { ...process.env, CLOUDFLARE_API_TOKEN: deployConfig.cloudflare.apiToken },
        }
      );
      steps.push({ step: 'create_project', output: 'Project created or already exists', success: true });
    } catch (error: any) {
      steps.push({ step: 'create_project', output: error.message, success: true }); // Not fatal
    }

    // Step 3: Deploy
    try {
      const distDir = args.distDir || 'dist';
      const { stdout, stderr } = await execAsync(
        `npx wrangler pages deploy ${distDir} --project-name ${args.projectName} --branch ${args.branch || 'main'}`,
        {
          cwd: ctx.workspacePath,
          timeout: 120000,
          env: { ...process.env, CLOUDFLARE_API_TOKEN: deployConfig.cloudflare.apiToken },
        }
      );
      const output = stdout + stderr;
      steps.push({ step: 'deploy', output: output.substring(0, 3000), success: true });

      // Extract URL from output
      const urlMatch = output.match(/https:\/\/[^\s]+\.pages\.dev/);
      const url = urlMatch ? urlMatch[0] : `https://${args.projectName}.pages.dev`;

      return { success: true, url, projectName: args.projectName, steps };
    } catch (error: any) {
      steps.push({ step: 'deploy', output: error.message, success: false });
      return { success: false, steps, error: 'Deployment failed' };
    }
  }
);

// ============================================================
// DEPLOY TO VERCEL
// ============================================================
toolRegistry.register(
  {
    name: 'deploy_vercel',
    category: 'deploy',
    description: 'Deploy a workspace project to Vercel.',
    parameters: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'Vercel project name' },
        buildCommand: { type: 'string', description: 'Build command' },
        outputDir: { type: 'string', description: 'Build output directory' },
        prod: { type: 'boolean', description: 'Deploy to production', default: false },
      },
      required: ['projectName'],
    },
    requiresApproval: true,
    riskLevel: 'moderate',
    timeout: 120000,
  },
  z.object({ projectName: z.string(), buildCommand: z.string().optional(), outputDir: z.string().optional(), prod: z.boolean().optional() }),
  async (args, ctx) => {
    if (!deployConfig.vercel.token) {
      throw new Error('VERCEL_TOKEN not configured in .env');
    }

    const prodFlag = args.prod ? '--prod' : '';
    const buildFlag = args.buildCommand ? `--build-env BUILD_COMMAND="${args.buildCommand}"` : '';

    try {
      const { stdout, stderr } = await execAsync(
        `npx vercel deploy ${prodFlag} ${buildFlag} --token ${deployConfig.vercel.token} --yes`,
        {
          cwd: ctx.workspacePath,
          timeout: 120000,
          env: { ...process.env },
        }
      );
      const output = stdout + stderr;
      const urlMatch = output.match(/https:\/\/[^\s]+\.vercel\.app/);

      return {
        success: true,
        url: urlMatch ? urlMatch[0] : 'Check Vercel dashboard',
        output: output.substring(0, 3000),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
);

// ============================================================
// DEPLOY STATUS
// ============================================================
toolRegistry.register(
  {
    name: 'deploy_status',
    category: 'deploy',
    description: 'Check the status of a deployment on Cloudflare Pages.',
    parameters: {
      type: 'object',
      properties: {
        projectName: { type: 'string', description: 'Project name to check' },
        platform: { type: 'string', enum: ['cloudflare', 'vercel'], default: 'cloudflare' },
      },
      required: ['projectName'],
    },
    riskLevel: 'safe',
  },
  z.object({ projectName: z.string(), platform: z.string().optional() }),
  async (args, ctx) => {
    try {
      const { stdout } = await execAsync(
        `npx wrangler pages deployment list --project-name ${args.projectName} 2>&1 | head -20`,
        {
          cwd: ctx.workspacePath,
          timeout: 15000,
          env: { ...process.env, CLOUDFLARE_API_TOKEN: deployConfig.cloudflare.apiToken },
        }
      );
      return { projectName: args.projectName, deployments: stdout.trim() };
    } catch (error: any) {
      return { error: error.message };
    }
  }
);

// ============================================================
// DEPLOY PREVIEW (local)
// ============================================================
toolRegistry.register(
  {
    name: 'deploy_preview',
    category: 'deploy',
    description: 'Start a local preview server for the workspace project.',
    parameters: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'Port for preview server', default: 3001 },
        distDir: { type: 'string', description: 'Directory to serve', default: 'dist' },
      },
    },
    riskLevel: 'safe',
    timeout: 10000,
  },
  z.object({ port: z.number().optional(), distDir: z.string().optional() }),
  async (args, ctx) => {
    const port = args.port || 3001;
    const distDir = args.distDir || 'dist';

    // Kill existing preview
    try { await execAsync(`fuser -k ${port}/tcp 2>/dev/null || true`); } catch {}

    // Start preview in background
    exec(
      `npx serve ${distDir} -l ${port} &`,
      { cwd: ctx.workspacePath }
    );

    return { url: `http://localhost:${port}`, port, serving: distDir };
  }
);

export default toolRegistry;
