#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { createCodeDump } from '../services/zipProcessor';
import { DEFAULT_MODEL_PRICING_INPUT_PER_MILLION, DEFAULT_SECURITY_LIMITS } from '../constants';
import { CustomScanRule, DumpOptions, OutputFormat } from '../types';

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            if (!out.input) out.input = arg;
            else if (!out.output) out.output = arg;
            continue;
        }
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) out[key] = true;
        else {
            out[key] = next;
            i++;
        }
    }
    return out;
}

function parseFocusPathsFromPatchText(text: string): string[] {
    const out = new Set<string>();
    for (const line of text.split(/\r?\n/)) {
        const diff = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        const plus = line.match(/^\+\+\+ b\/(.+)$/);
        const renameTo = line.match(/^rename to (.+)$/);
        const candidate = diff?.[2] ?? plus?.[1] ?? renameTo?.[1];
        if (candidate && candidate !== '/dev/null') out.add(candidate.replace(/\\/g, '/').replace(/^\/+/, ''));
    }
    return Array.from(out).sort();
}

function parseCustomRules(text: string): CustomScanRule[] {
    if (!text.trim()) return [];
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Custom rules must be a JSON array.');
    return parsed as CustomScanRule[];
}

function splitList(value: string | boolean | undefined): string[] {
    if (!value || value === true) return [];
    return String(value).split(/[,\n]/).map(item => item.trim()).filter(Boolean);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!args.input || args.help) {
        console.log(`codedump-from-zip CLI

Usage:
  npm run cli -- project.zip output.md [options]
  codedump-from-zip project.zip output.md [options]

Options:
  --format markdown|xml|json
  --max-tokens 120000
  --focus src/a.ts,src/a.test.ts       Changed-path focus list
  --include "**/*.ts,**/*.py"
  --exclude "**/vendor/**,**/*.lock"
  --no-llm-review
  --no-condense
  --prompt-action warn|redact|skip
  --focus-from-patch pr.patch          Extract changed paths from unified diff
  --custom-rules rules.json            Enterprise secret/prompt-injection rules
  --ast-mode off|comments|skeleton
`);
        process.exit(args.help ? 0 : 1);
    }

    const inputPath = String(args.input);
    const outputPath = String(args.output || 'codedump.md');
    const patchFocus = args['focus-from-patch'] ? parseFocusPathsFromPatchText(await readFile(String(args['focus-from-patch']), 'utf8')) : [];
    const customRules = args['custom-rules'] ? parseCustomRules(await readFile(String(args['custom-rules']), 'utf8')) : [];

    const zipBuffer = await readFile(inputPath);
    const arrayBuffer = zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength);

    const options: DumpOptions = {
        include: splitList(args.include).length ? splitList(args.include) : ['**/*'],
        exclude: splitList(args.exclude),
        maxSize: args['max-size'] ? Number(args['max-size']) : 2_000_000,
        binaryMode: 'skip',
        showMetadata: true,
        sort: 'path',
        strictText: false,
        outputFormat: (args.format ? String(args.format) : 'markdown') as OutputFormat,
        tokenizerMode: 'openai',
        modelPricingInputPerMillion: DEFAULT_MODEL_PRICING_INPUT_PER_MILLION,
        selectedPaths: null,
        security: DEFAULT_SECURITY_LIMITS,
        useGitignore: true,
        useDockerignore: true,
        includeRepoMap: true,
        condenseCode: args['no-condense'] ? false : true,
        astCondensationMode: (args['ast-mode'] ? String(args['ast-mode']) : 'comments') as DumpOptions['astCondensationMode'],
        secretScanning: true,
        customRules,
        maxTokensPerFile: args['max-tokens'] ? Number(args['max-tokens']) : null,
        llmCodeReviewMode: !args['no-llm-review'],
        entropySecretScanning: true,
        promptInjectionScanning: true,
        promptInjectionAction: (args['prompt-action'] ? String(args['prompt-action']) : 'redact') as DumpOptions['promptInjectionAction'],
        semanticChunking: true,
        reviewFocusPaths: [...splitList(args.focus), ...patchFocus],
        tokenTreemapEnabled: false,
    };

    const result = await createCodeDump(
        arrayBuffer,
        options,
        (percent, message) => process.stderr.write(`\r${String(percent).padStart(3)}% ${message ?? ''}`),
        undefined,
        path.basename(inputPath)
    );
    process.stderr.write('\n');

    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    if (result.parts.length <= 1) {
        await writeFile(outputPath, result.content, 'utf8');
    } else {
        const outZip = new JSZip();
        for (const part of result.parts) outZip.file(part.filename, part.content);
        const data = await outZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        await writeFile(outputPath.replace(/\.(md|xml|json)$/i, '.zip'), data);
    }

    console.error(`Done: ${result.stats.fileCount} files, ${result.stats.tokenCount} tokens, ${result.warnings.length} warning(s).`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
