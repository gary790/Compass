import { toolRegistry } from '../registry.js';
import { z } from 'zod';
import { callLLM } from '../../llm/router.js';
import { getBestModelForTask } from '../../config/index.js';

// ============================================================
// CODE ANALYZE
// ============================================================
toolRegistry.register(
  {
    name: 'code_analyze',
    category: 'code',
    description: 'Analyze code for bugs, security issues, performance problems, and best practice violations.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to analyze' },
        language: { type: 'string', description: 'Programming language' },
        focus: { type: 'string', enum: ['bugs', 'security', 'performance', 'style', 'all'], default: 'all' },
      },
      required: ['code', 'language'],
    },
    riskLevel: 'safe',
  },
  z.object({ code: z.string(), language: z.string(), focus: z.string().optional() }),
  async (args) => {
    const model = getBestModelForTask('code_review');
    const response = await callLLM({
      provider: model.provider,
      model: model.model,
      messages: [
        {
          role: 'system',
          content: `You are a senior code reviewer. Analyze the following ${args.language} code for ${args.focus || 'all'} issues. Return a JSON object with: { issues: [{ severity: "critical"|"warning"|"info", category: string, line: number|null, message: string, suggestion: string }], summary: string, score: number (0-100) }`,
        },
        { role: 'user', content: args.code },
      ],
      temperature: 0.3,
      responseFormat: 'json',
    });

    try {
      return JSON.parse(response.content || '{}');
    } catch {
      return { summary: response.content, issues: [], score: 0 };
    }
  }
);

// ============================================================
// CODE EXPLAIN
// ============================================================
toolRegistry.register(
  {
    name: 'code_explain',
    category: 'code',
    description: 'Explain what a piece of code does in plain English.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to explain' },
        language: { type: 'string', description: 'Programming language' },
        detail: { type: 'string', enum: ['brief', 'detailed', 'eli5'], default: 'detailed' },
      },
      required: ['code'],
    },
    riskLevel: 'safe',
  },
  z.object({ code: z.string(), language: z.string().optional(), detail: z.string().optional() }),
  async (args) => {
    const model = getBestModelForTask('general_reasoning');
    const detailKey = (args.detail || 'detailed') as keyof typeof detailPrompt;
    const detailPrompt = {
      brief: 'Give a brief 1-2 sentence explanation.',
      detailed: 'Give a detailed explanation covering the logic, data flow, and purpose.',
      eli5: 'Explain like I\'m a beginner programmer.',
    };

    const response = await callLLM({
      provider: model.provider,
      model: model.model,
      messages: [
        { role: 'system', content: `You are a code explainer. ${detailPrompt[detailKey]}` },
        { role: 'user', content: `Explain this ${args.language || ''} code:\n\n${args.code}` },
      ],
      temperature: 0.5,
    });

    return { explanation: response.content, language: args.language };
  }
);

// ============================================================
// CODE GENERATE
// ============================================================
toolRegistry.register(
  {
    name: 'code_generate',
    category: 'code',
    description: 'Generate code from a natural language description.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the code should do' },
        language: { type: 'string', description: 'Target programming language' },
        framework: { type: 'string', description: 'Framework to use (e.g., React, Express, Hono)' },
        context: { type: 'string', description: 'Additional context (existing code, constraints)' },
      },
      required: ['description', 'language'],
    },
    riskLevel: 'safe',
  },
  z.object({ description: z.string(), language: z.string(), framework: z.string().optional(), context: z.string().optional() }),
  async (args) => {
    const model = getBestModelForTask('code_generation');
    const frameworkNote = args.framework ? ` using ${args.framework}` : '';
    const contextNote = args.context ? `\n\nContext:\n${args.context}` : '';

    const response = await callLLM({
      provider: model.provider,
      model: model.model,
      messages: [
        {
          role: 'system',
          content: `You are an expert ${args.language} developer. Generate clean, well-commented, production-ready code. Only output the code, no explanations unless asked.`,
        },
        {
          role: 'user',
          content: `Generate ${args.language} code${frameworkNote}: ${args.description}${contextNote}`,
        },
      ],
      temperature: 0.3,
    });

    // Extract code block if wrapped in markdown
    let code = response.content || '';
    const codeBlockMatch = code.match(/```(?:\w+)?\n([\s\S]+?)\n```/);
    if (codeBlockMatch) code = codeBlockMatch[1];

    return { code, language: args.language, framework: args.framework };
  }
);

// ============================================================
// CODE TEST (generate tests)
// ============================================================
toolRegistry.register(
  {
    name: 'code_test',
    category: 'code',
    description: 'Generate test cases for a piece of code.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to generate tests for' },
        language: { type: 'string', description: 'Programming language' },
        framework: { type: 'string', description: 'Test framework (jest, vitest, mocha, pytest)', default: 'vitest' },
      },
      required: ['code', 'language'],
    },
    riskLevel: 'safe',
  },
  z.object({ code: z.string(), language: z.string(), framework: z.string().optional() }),
  async (args) => {
    const model = getBestModelForTask('code_generation');
    const response = await callLLM({
      provider: model.provider,
      model: model.model,
      messages: [
        {
          role: 'system',
          content: `You are a test engineer. Generate comprehensive test cases using ${args.framework || 'vitest'}. Cover happy paths, edge cases, and error scenarios. Output only the test code.`,
        },
        { role: 'user', content: `Generate tests for:\n\n${args.code}` },
      ],
      temperature: 0.3,
    });

    let testCode = response.content || '';
    const codeBlockMatch = testCode.match(/```(?:\w+)?\n([\s\S]+?)\n```/);
    if (codeBlockMatch) testCode = codeBlockMatch[1];

    return { testCode, framework: args.framework || 'vitest' };
  }
);

// ============================================================
// CODE REFACTOR
// ============================================================
toolRegistry.register(
  {
    name: 'code_refactor',
    category: 'code',
    description: 'Suggest and apply refactoring improvements to code.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Code to refactor' },
        language: { type: 'string', description: 'Programming language' },
        goals: { type: 'string', description: 'Refactoring goals (e.g., "improve readability", "reduce complexity")' },
      },
      required: ['code', 'language'],
    },
    riskLevel: 'safe',
  },
  z.object({ code: z.string(), language: z.string(), goals: z.string().optional() }),
  async (args) => {
    const model = getBestModelForTask('code_review');
    const response = await callLLM({
      provider: model.provider,
      model: model.model,
      messages: [
        {
          role: 'system',
          content: `You are a refactoring expert. Improve the code based on: ${args.goals || 'readability, performance, and best practices'}. Return JSON: { refactoredCode: string, changes: [{ description: string, before: string, after: string }], summary: string }`,
        },
        { role: 'user', content: args.code },
      ],
      temperature: 0.3,
      responseFormat: 'json',
    });

    try {
      return JSON.parse(response.content || '{}');
    } catch {
      return { refactoredCode: response.content, changes: [], summary: 'See refactored code' };
    }
  }
);

export default toolRegistry;
