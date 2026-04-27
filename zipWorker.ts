import JSZip from 'jszip';
import { Unzip, AsyncUnzipInflate } from 'fflate';
import { minimatch } from 'minimatch';
import { getEncoding } from 'js-tiktoken';
import { DEFAULT_EXCLUDES, LLM_CODE_REVIEW_EXCLUDES, LLM_CODE_REVIEW_INCLUDES } from '../constants';
import { CustomScanRule, DumpOptions, DumpPart, DumpResult, FileResult, ZipInspection, ZipEntryInfo } from '../types';

const DEFAULT_DATE = new Date(0);
const TEXT_ENCODER = new TextEncoder();

function guessLanguage(filename: string): string {
    const extension = (filename.split('.').pop() || '').toLowerCase();
    switch (extension) {
        case "py": return "python";
        case "ipynb": return "json";
        case "js": case "mjs": case "cjs": return "javascript";
        case "ts": return "typescript";
        case "jsx": return "jsx";
        case "tsx": return "tsx";
        case "java": return "java";
        case "kt": return "kotlin";
        case "rs": return "rust";
        case "go": return "go";
        case "cpp": case "cc": case "cxx": return "cpp";
        case "c": return "c";
        case "cs": return "csharp";
        case "php": return "php";
        case "rb": return "ruby";
        case "swift": return "swift";
        case "sh": case "bash": return "bash";
        case "ps1": return "powershell";
        case "html": case "htm": return "html";
        case "css": return "css";
        case "scss": case "sass": return "scss";
        case "md": return "markdown";
        case "json": return "json";
        case "toml": return "toml";
        case "ini": case "cfg": case "conf": return "ini";
        case "yaml": case "yml": return "yaml";
        case "xml": return "xml";
        case "sql": return "sql";
        case "csv": return "csv";
        case "txt": return "";
        default: return "";
    }
}

export function sanitizeZipPath(rawPath: string, maxLength = 512): string {
    const normalized = rawPath
        .replace(/\\/g, '/')
        .replace(/\u0000/g, '')
        .replace(/\/+/g, '/')
        .trim();

    const parts: string[] = [];
    for (const part of normalized.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') continue;
        const clean = part.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128);
        if (clean) parts.push(clean);
    }

    const result = parts.join('/');
    if (!result) return 'unnamed';
    return result.slice(0, maxLength);
}

function getCompressedSize(zipFile: any): number {
    const data = zipFile?._data;
    if (typeof data?.compressedSize === 'number') return data.compressedSize;
    if (typeof data?.compressedContent?.length === 'number') return data.compressedContent.length;
    return 0;
}

function getUncompressedSize(zipFile: any): number {
    const data = zipFile?._data;
    if (typeof data?.uncompressedSize === 'number') return data.uncompressedSize;
    if (typeof data?.uncompressedContent?.length === 'number') return data.uncompressedContent.length;
    return 0;
}

function isZipEntrySymlink(zipFile: any): boolean {
    const unixPermissions = Number(zipFile?.unixPermissions ?? zipFile?._data?.unixPermissions ?? 0);
    return unixPermissions > 0 && ((unixPermissions & 0o170000) === 0o120000);
}

function formatDatetime(date: Date | undefined): string {
    return (date ?? DEFAULT_DATE).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

function isProbablyBinary(data: Uint8Array): boolean {
    if (data.slice(0, 4096).includes(0)) return true;
    const sample = data.slice(0, 8192);
    if (sample.length === 0) return false;
    let nonTextCount = 0;
    for (const byte of sample) {
        const isTextByte = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 160;
        if (!isTextByte) nonTextCount++;
    }
    return (nonTextCount / sample.length) > 0.30;
}

function decodeText(data: Uint8Array, strictText: boolean): string | null {
    const decoders: Array<[string, TextDecoder]> = [
        ['utf-8', new TextDecoder('utf-8', { fatal: strictText })],
        ['utf-16le', new TextDecoder('utf-16le', { fatal: false })],
        ['utf-16be', new TextDecoder('utf-16be', { fatal: false })],
    ];

    if (data.length >= 2) {
        const bom = (data[0] << 8) | data[1];
        try {
            if (bom === 0xfeff) return decoders[2][1].decode(data.subarray(2));
            if (bom === 0xfffe) return decoders[1][1].decode(data.subarray(2));
        } catch {
            if (strictText) return null;
        }
    }

    try {
        return decoders[0][1].decode(data);
    } catch {
        if (strictText) return null;
        try {
            return new TextDecoder('utf-8', { fatal: false }).decode(data);
        } catch {
            return null;
        }
    }
}

function normalizeForScanning(text: string): string {
    return text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function clampLinesForScanning(text: string, maxLineLength: number): string {
    return text
        .split(/\r?\n/)
        .map(line => line.length > maxLineLength ? `${line.slice(0, maxLineLength)}\n[TRUNCATED_LONG_LINE_FOR_SAFE_SCANNING:${line.length}]` : line)
        .join('\n');
}

function isNestedQuantifierRisk(pattern: string): boolean {
    return /\([^)]{0,80}[+*][^)]{0,80}\)\s*[+*{]/.test(pattern) || /\[[^\]]*\]\s*\{\d+,?\}\s*[+*{]/.test(pattern);
}

function compileSafeRegex(rule: CustomScanRule, maxPatternLength: number): RegExp | null {
    if (!rule.pattern || rule.pattern.length > maxPatternLength) return null;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(rule.pattern)) return null;
    if (isNestedQuantifierRisk(rule.pattern)) return null;
    try {
        const flags = rule.caseSensitive ? 'g' : 'gi';
        return new RegExp(rule.pattern, flags);
    } catch {
        return null;
    }
}

function decodeBase64Candidate(token: string, maxBytes: number): string | null {
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
    if (normalized.length < 30 || normalized.length > Math.ceil(maxBytes * 1.4)) return null;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
    try {
        let binary = '';
        if (typeof atob === 'function') {
            binary = atob(normalized);
        } else {
            const BufferCtor = (globalThis as unknown as { Buffer?: { from: (input: string, encoding: string) => { toString: (encoding: string) => string; length: number } } }).Buffer;
            if (!BufferCtor) return null;
            const buf = BufferCtor.from(normalized, 'base64');
            if (buf.length > maxBytes) return null;
            return buf.toString('utf8');
        }
        if (binary.length > maxBytes) return null;
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
        return null;
    }
}

function looksLikeNestedZip(data: Uint8Array): boolean {
    return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}


async function zipInputToUint8Array(zipInput: File | ArrayBuffer): Promise<Uint8Array> {
    if (typeof File !== "undefined" && zipInput instanceof File) return new Uint8Array(await zipInput.arrayBuffer());
    return new Uint8Array(zipInput as ArrayBuffer);
}

function concatUint8Chunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
    }
    return output;
}

interface StreamedZipPayload {
    data: Uint8Array;
    extractedSize: number;
    declaredSize: number;
}

async function extractSelectedFilesStreaming(
    zipInput: File | ArrayBuffer,
    selectedSafePaths: Set<string>,
    declaredSizeBySafePath: Map<string, number>,
    options: DumpOptions,
    signal?: AbortSignal
): Promise<Map<string, StreamedZipPayload>> {
    const source = await zipInputToUint8Array(zipInput);
    const results = new Map<string, StreamedZipPayload>();
    if (selectedSafePaths.size === 0) return results;

    return new Promise((resolve, reject) => {
        let activeFiles = 0;
        let inputFinished = false;
        let settled = false;
        let runningTotal = 0;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const maybeResolve = () => {
            if (!settled && inputFinished && activeFiles === 0) {
                settled = true;
                resolve(results);
            }
        };

        const unzip = new Unzip((file) => {
            if (settled) return;
            const safePath = sanitizeZipPath(file.name, options.security.maxPathLength);
            if (!selectedSafePaths.has(safePath)) return;

            // fflate exposes size information from the local ZIP stream. For perfectly normal
            // archives this value can be the compressed size or a placeholder when data
            // descriptors are used. Therefore the authoritative limit for this guard is the
            // Central Directory size collected by JSZip during inspection, keyed by the
            // sanitized path. The local value is only a fallback for archives where the
            // Central Directory parser could not provide a size.
            const localDeclaredSize = Number((file as unknown as { size?: number; originalSize?: number }).size ?? (file as unknown as { originalSize?: number }).originalSize ?? 0);
            const centralDeclaredSize = declaredSizeBySafePath.get(safePath) ?? 0;
            const declaredSize = centralDeclaredSize > 0 ? centralDeclaredSize : localDeclaredSize;
            const chunks: Uint8Array[] = [];
            let extractedSize = 0;
            activeFiles += 1;

            file.ondata = (err, chunk, final) => {
                if (settled) return;
                if (err) {
                    activeFiles -= 1;
                    fail(err instanceof Error ? err : new Error(String(err)));
                    return;
                }
                if (signal?.aborted) {
                    activeFiles -= 1;
                    fail(new DOMException('Processing cancelled', 'AbortError'));
                    return;
                }

                extractedSize += chunk.length;
                runningTotal += chunk.length;

                if (options.maxSize !== null && extractedSize > options.maxSize) {
                    activeFiles -= 1;
                    fail(new Error(`Streaming ZIP guard blocked ${safePath}: extracted ${extractedSize} bytes; per-file limit is ${options.maxSize}.`));
                    return;
                }
                if (runningTotal > options.security.maxTotalUncompressedBytes) {
                    activeFiles -= 1;
                    fail(new Error(`Streaming ZIP guard blocked archive: extracted total exceeded ${options.security.maxTotalUncompressedBytes} bytes.`));
                    return;
                }
                if (declaredSize > 0 && extractedSize > Math.max(declaredSize * 1.10, declaredSize + 64 * 1024)) {
                    activeFiles -= 1;
                    fail(new Error(`Streaming ZIP guard blocked ${safePath}: extracted stream exceeded Central Directory declared size (${declaredSize} -> ${extractedSize}).`));
                    return;
                }

                chunks.push(chunk);
                if (final) {
                    results.set(safePath, { data: concatUint8Chunks(chunks, extractedSize), extractedSize, declaredSize });
                    activeFiles -= 1;
                    maybeResolve();
                }
            };

            file.start();
        });

        unzip.register(AsyncUnzipInflate);

        try {
            const chunkSize = 64 * 1024;
            for (let offset = 0; offset < source.length; offset += chunkSize) {
                if (signal?.aborted) throw new DOMException('Processing cancelled', 'AbortError');
                unzip.push(source.subarray(offset, Math.min(offset + chunkSize, source.length)), offset + chunkSize >= source.length);
            }
            inputFinished = true;
            maybeResolve();
        } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

export function validateGlobPattern(pattern: string, maxLength = 100): string | null {
    if (pattern.length > maxLength) return `Pattern is too long (${pattern.length}/${maxLength}): ${pattern.slice(0, 80)}`;
    if (/[\x00-\x1f\x7f]/.test(pattern)) return `Pattern contains control characters: ${pattern}`;
    if (/\*{3,}/.test(pattern)) return `Pattern contains unsafe wildcard run: ${pattern}`;
    if (/\+{2,}/.test(pattern)) return `Pattern contains unsafe quantifier run: ${pattern}`;
    if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) return `Pattern resembles catastrophic nested quantifiers: ${pattern}`;
    return null;
}

function validateGlobList(patterns: string[], options: DumpOptions): string[] {
    return patterns.map(p => validateGlobPattern(p, options.security.maxPatternLength)).filter((v): v is string => Boolean(v));
}

function globMatch(posixPath: string, pattern: string): boolean {
    return minimatch(posixPath, pattern, { dot: true, nobrace: false, noext: false, nocase: false });
}

function shouldSkip(filename: string, include: string[], exclude: string[], options: DumpOptions): boolean {
    const posixPath = filename.replace(/\\/g, "/");
    const includeErrors = validateGlobList(include, options);
    const excludeErrors = validateGlobList(exclude, options);
    if (includeErrors.length || excludeErrors.length) throw new Error(`Unsafe glob pattern blocked: ${[...includeErrors, ...excludeErrors].join('; ')}`);
    if (include.length > 0 && !include.some(p => globMatch(posixPath, p))) return true;
    const allExcludes = [...DEFAULT_EXCLUDES, ...exclude];
    let skipped = false;
    for (const pattern of allExcludes) {
        if (pattern.startsWith('!')) {
            if (globMatch(posixPath, pattern.slice(1))) skipped = false;
        } else if (globMatch(posixPath, pattern)) {
            skipped = true;
        }
    }
    return skipped;
}

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(buffer: ArrayBuffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = new Uint8Array(buffer);
    let output = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const triplet = (a << 16) | (b << 8) | c;
        output += alphabet[(triplet >> 18) & 63];
        output += alphabet[(triplet >> 12) & 63];
        output += i + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '=';
        output += i + 2 < bytes.length ? alphabet[triplet & 63] : '=';
    }
    return output;
}

function escapeXml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function markdownFile(metadata: {path: string; size: number; modified: string}, body: string, lang: string, options: DumpOptions, details: string[] = []): string {
    const metadataLines = options.showMetadata ? [`- Path: \`${metadata.path}\``, `- Size: ${metadata.size} Bytes`, `- Modified: ${metadata.modified}`] : [];
    const allDetails = [...metadataLines, ...details];
    const header = `## File: \`${metadata.path}\`${allDetails.length ? `  \n${allDetails.join('  \n')}` : ''}\n\n`;
    if (details.some(d => d.startsWith('- Skipped') || d.startsWith('- Warning'))) return header + `> ${details[details.length - 1].replace(/^- /, '')}\n\n`;
    return header + `\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
}

function normalizeIgnorePattern(pattern: string): string[] {
    let value = pattern.trim();
    if (!value || value.startsWith('#')) return [];
    let negated = false;
    if (value.startsWith('!')) {
        negated = true;
        value = value.slice(1).trim();
    }
    if (!value || value.startsWith('#')) return [];
    value = value.replace(/\\/g, '/').replace(/^\/+/, '');
    if (value.endsWith('/')) value = `${value}**`;
    const candidates = value.includes('/') ? [value, `**/${value}`] : [value, `**/${value}`, `**/${value}/**`];
    return candidates.map(candidate => negated ? `!${candidate}` : candidate);
}

function parseIgnoreFile(text: string, limit = 500): string[] {
    const rules: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        rules.push(...normalizeIgnorePattern(line));
        if (rules.length >= limit) break;
    }
    return Array.from(new Set(rules));
}

function applyIgnoreRulesToExcludes(baseExcludes: string[], rules: string[]): string[] {
    const excludes = new Set(baseExcludes);
    for (const rule of rules) excludes.add(rule);
    return Array.from(excludes);
}


function mergeUniquePatterns(...groups: string[][]): string[] {
    return Array.from(new Set(groups.flat().filter(Boolean)));
}

function isLlmCodeReviewNeverInclude(path: string): boolean {
    const name = path.split('/').pop() ?? path;
    if (/^package-lock\.json$|^npm-shrinkwrap\.json$|^yarn\.lock$|^pnpm-lock\.yaml$/i.test(name)) return true;
    if (/\.min\.(js|css)$/i.test(name) || /\.map$/i.test(name)) return true;
    if (/(^|\/)(node_modules|dist|build|release|releases|coverage|reports?|data|datasets|vendor|third_party|external)(\/|$)/i.test(path)) return true;
    return false;
}

function llmCodeReviewRank(path: string): number {
    const lower = path.toLowerCase();
    const name = lower.split('/').pop() ?? lower;

    // High-level orientation first: lets an LLM establish intent before reading implementation.
    if (/^(readme|architecture|overview|design|contributing|security|implementation_notes|enterprise_upgrade)/.test(name)) return 0;

    // Runtime/build manifests and project-level config next.
    if (/^(package\.json|pyproject\.toml|requirements.*\.txt|cargo\.toml|go\.mod|pom\.xml|build\.gradle|settings\.gradle|composer\.json|gemfile|mix\.exs|pubspec\.yaml)$/.test(name)) return 1;
    if (/^(vite|webpack|rollup|tsconfig|jsconfig|tailwind|postcss|eslint|prettier|babel|jest|vitest|pytest|tox|mypy|ruff|docker-compose|dockerfile|makefile|cmakelists)/.test(name)) return 1;

    // Security/desktop/runtime boundaries before ordinary code.
    if (/(^|\/)(electron|security|auth|permission|permissions|middleware|infra|deploy|k8s|helm|terraform)(\/|$)/.test(lower)) return 2;

    // Core implementation.
    if (/(^|\/)(src|app|lib|services|service|core|domain|internal|cmd|pkg|components|pages|routes|controllers|models|schemas|stores|hooks)(\/|$)/.test(lower)) return 3;

    // Tests after implementation: useful, but usually secondary for initial review.
    if (/(^|\/)(__tests__|tests?|spec|e2e)(\/|$)|(\.test|\.spec)\./.test(lower)) return 4;

    // Everything else allowed by the language-agnostic profile.
    return 5;
}

function sortForLlmCodeReview(files: any[], safePathFor: (file: any) => string): any[] {
    return files.sort((a, b) => {
        const aPath = safePathFor(a);
        const bPath = safePathFor(b);
        return llmCodeReviewRank(aPath) - llmCodeReviewRank(bPath) || aPath.localeCompare(bPath);
    });
}


async function readSmallTextFile(zip: JSZip, names: string[], maxBytes: number): Promise<string | null> {
    for (const name of names) {
        const entry = zip.file(name);
        if (!entry) continue;
        if (getUncompressedSize(entry) > maxBytes) continue;
        const data = await entry.async('uint8array');
        return decodeText(data, false);
    }
    return null;
}

function detectPreset(paths: Set<string>): { preset: string | null; stack: string | null } {
    const has = (name: string) => paths.has(name);
    const any = (predicate: (path: string) => boolean) => Array.from(paths).some(predicate);
    if (has('Cargo.toml')) return { preset: 'rust-crate', stack: 'Rust crate' };
    if (has('pom.xml')) return { preset: 'java-maven', stack: 'Java Maven' };
    if (any(p => p.endsWith('.csproj')) || any(p => p.endsWith('.sln'))) return { preset: 'dotnet', stack: '.NET' };
    if (has('pyproject.toml') || has('requirements.txt') || any(p => p.endsWith('.py'))) return { preset: 'python-web', stack: 'Python' };
    if (has('package.json')) {
        if (has('vite.config.ts') || has('vite.config.js') || any(p => p.endsWith('.tsx') || p.endsWith('.jsx'))) return { preset: 'react', stack: 'React/Vite' };
        return { preset: 'node-app', stack: 'Node.js' };
    }
    return { preset: null, stack: null };
}

function calculateShannonEntropy(value: string): number {
    const counts = new Map<string, number>();
    for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
    let entropy = 0;
    for (const count of counts.values()) {
        const probability = count / value.length;
        entropy -= probability * Math.log2(probability);
    }
    return entropy;
}

function looksLikeBenignHighEntropyToken(token: string): boolean {
    if (/^[a-f0-9]{40}$/i.test(token)) return true; // likely commit SHA
    if (/^[a-f0-9]{64}$/i.test(token)) return true; // likely checksum; keep unless key assignment regex caught it
    if (/^[A-Z0-9_]+$/.test(token) && token.length < 32) return true; // constants/enums
    if (/^(https?|file|data):/i.test(token)) return true;
    return false;
}

function defaultSecretRules(): Array<{ name: string; regex: RegExp; replacement: string }> {
    return [
        { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_ACCESS_KEY]' },
        { name: 'OpenAI API key', regex: /\bsk-[A-Za-z0-9_-]{32,}\b/g, replacement: '[REDACTED_OPENAI_KEY]' },
        { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
        { name: 'Google API key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g, replacement: '[REDACTED_GOOGLE_API_KEY]' },
        { name: 'Private key block', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----[^]*?-----END (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
        { name: 'Bearer token', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/g, replacement: 'Bearer [REDACTED_TOKEN]' },
        { name: 'Generic assignment secret', regex: /\b(api[_-]?key|secret|password|passwd|token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{16,})["']?/gi, replacement: '$1=[REDACTED_SECRET]' },
    ];
}

function redactSecrets(text: string, options: DumpOptions): { text: string; warnings: string[]; count: number; entropyCount: number; customCount: number } {
    const patterns = defaultSecretRules();
    let output = text;
    let count = 0;
    let entropyCount = 0;
    let customCount = 0;
    const warnings: string[] = [];

    // Line caps are applied before regex analysis to reduce ReDoS exposure on minified or adversarial lines.
    output = clampLinesForScanning(output, options.security.maxScanLineLength);

    for (const pattern of patterns) {
        let localCount = 0;
        output = output.replace(pattern.regex, () => {
            localCount += 1;
            return pattern.replacement;
        });
        if (localCount > 0) {
            count += localCount;
            warnings.push(`${localCount} ${pattern.name} occurrence(s) redacted`);
        }
    }

    const customRules = (options.customRules ?? []).filter(rule => rule.type === 'secret').slice(0, options.security.maxCustomRules);
    for (const rule of customRules) {
        const regex = compileSafeRegex(rule, options.security.maxCustomRulePatternLength);
        if (!regex) {
            warnings.push(`Custom secret rule skipped as unsafe or invalid: ${rule.id || 'unnamed'}`);
            continue;
        }
        let localCount = 0;
        output = output.replace(regex, () => {
            localCount += 1;
            return rule.replacement || `[REDACTED_CUSTOM_SECRET:${rule.id || 'rule'}]`;
        });
        if (localCount > 0) {
            customCount += localCount;
            count += localCount;
            warnings.push(`${localCount} custom secret rule match(es): ${rule.id || 'unnamed'}`);
        }
    }

    if (options.entropySecretScanning) {
        output = output.replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, (token) => {
            if (looksLikeBenignHighEntropyToken(token)) return token;
            const entropy = calculateShannonEntropy(token);
            const isHex = /^[a-f0-9]+$/i.test(token);
            const isBase64ish = /^[A-Za-z0-9+/=_-]+$/.test(token);
            const threshold = isHex ? 3.75 : 4.45;
            if (isBase64ish && entropy >= threshold) {
                entropyCount += 1;
                return `[REDACTED_HIGH_ENTROPY_${isHex ? 'HEX' : 'STRING'}]`;
            }
            return token;
        });
        if (entropyCount > 0) {
            count += entropyCount;
            warnings.push(`${entropyCount} high-entropy custom secret candidate(s) redacted`);
        }
    }

    return { text: output, warnings, count, entropyCount, customCount };
}

interface PromptInjectionScan {
    text: string;
    warnings: string[];
    count: number;
    skip: boolean;
}

function promptInjectionPatterns(): Array<{ label: string; regex: RegExp }> {
    return [
        { label: 'ignore previous instructions', regex: /\bignore\s+(?:all\s+)?previous\s+instructions\b/gi },
        { label: 'system prompt exfiltration', regex: /\b(?:reveal|print|output|show)\s+(?:the\s+)?(?:system|developer)\s+prompt\b/gi },
        { label: 'role override', regex: /\byou\s+are\s+(?:now|no\s+longer)\b/gi },
        { label: 'instruction hierarchy bypass', regex: /\b(?:forget|disregard)\s+(?:all\s+)?(?:prior|previous|above)\s+(?:rules|instructions)\b/gi },
        { label: 'jailbreak framing', regex: /\b(?:jailbreak|DAN mode|developer mode|hypothetical scenario)\b/gi },
        { label: 'tool misuse prompt', regex: /\b(?:call|invoke|use)\s+(?:the\s+)?(?:browser|shell|terminal|python|tool)\b.{0,80}\b(?:without|ignore|bypass)\b/gi },
    ];
}

function applyPromptInjectionRules(input: string, path: string, options: DumpOptions, decodedSource = false): PromptInjectionScan & { decodedCount: number; customCount: number } {
    const triggerPatterns = promptInjectionPatterns();
    let output = input;
    let count = 0;
    let customCount = 0;
    const warnings: string[] = [];

    for (const pattern of triggerPatterns) {
        let local = 0;
        output = output.replace(pattern.regex, (match) => {
            local += 1;
            if (options.promptInjectionAction === 'redact') return `[REDACTED_PROMPT_INJECTION:${pattern.label}]`;
            return match;
        });
        if (local > 0) {
            count += local;
            warnings.push(`${local} prompt-injection-like phrase(s) detected${decodedSource ? ' inside decoded Base64' : ''}: ${pattern.label}`);
        }
    }

    const customRules = (options.customRules ?? []).filter(rule => rule.type === 'promptInjection').slice(0, options.security.maxCustomRules);
    for (const rule of customRules) {
        const regex = compileSafeRegex(rule, options.security.maxCustomRulePatternLength);
        if (!regex) {
            warnings.push(`Custom prompt-injection rule skipped as unsafe or invalid: ${rule.id || 'unnamed'}`);
            continue;
        }
        let local = 0;
        output = output.replace(regex, (match) => {
            local += 1;
            const action = rule.action ?? options.promptInjectionAction;
            if (action === 'redact') return rule.replacement || `[REDACTED_CUSTOM_PROMPT_INJECTION:${rule.id || 'rule'}]`;
            return match;
        });
        if (local > 0) {
            count += local;
            customCount += local;
            warnings.push(`${local} custom prompt-injection rule match(es): ${rule.id || 'unnamed'}`);
        }
    }

    const skip = count > 0 && options.promptInjectionAction === 'skip';
    if (count > 0) warnings.unshift(`Prompt-injection scan flagged ${path}; action=${options.promptInjectionAction}`);
    return { text: output, warnings, count, skip, decodedCount: decodedSource ? count : 0, customCount };
}

function scanPromptInjection(text: string, path: string, options: DumpOptions): PromptInjectionScan & { decodedCount: number; customCount: number } {
    const normalized = clampLinesForScanning(normalizeForScanning(text), options.security.maxScanLineLength);
    let result = applyPromptInjectionRules(normalized, path, options, false);
    const allWarnings = [...result.warnings];
    let output = result.text;
    let decodedCount = 0;
    let customCount = result.customCount;

    // De-obfuscation pass: decode Base64-looking tokens and scan decoded content. If malicious
    // instructions are found, redact the original encoded token so the downstream LLM never sees it.
    output = output.replace(/\b[A-Za-z0-9+/]{30,}={0,2}\b/g, (token) => {
        const decoded = decodeBase64Candidate(token, options.security.maxBase64DecodeBytes);
        if (!decoded) return token;
        const decodedResult = applyPromptInjectionRules(normalizeForScanning(decoded), path, options, true);
        if (decodedResult.count > 0) {
            decodedCount += decodedResult.count;
            customCount += decodedResult.customCount;
            allWarnings.push(...decodedResult.warnings.map(w => `${w} (original token redacted)`));
            return '[REDACTED_BASE64_PROMPT_INJECTION]';
        }
        return token;
    });

    const count = result.count + decodedCount;
    const skip = count > 0 && options.promptInjectionAction === 'skip';
    const limitedWarnings = allWarnings.slice(0, options.security.maxPromptInjectionFindings);
    if (allWarnings.length > limitedWarnings.length) limitedWarnings.push(`Additional prompt-injection findings suppressed: ${allWarnings.length - limitedWarnings.length}`);

    return { text: output, warnings: limitedWarnings, count, skip, decodedCount, customCount };
}


function stripCommentsSyntaxAware(text: string, ext: string): string {
    const mode = ['py', 'pyi'].includes(ext) ? 'python' : ['html', 'xml', 'svg', 'vue', 'svelte', 'astro'].includes(ext) ? 'markup' : 'cstyle';
    let out = '';
    let i = 0;
    let state: 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment' | 'pyTripleSingle' | 'pyTripleDouble' | 'markupComment' = 'code';
    const tripleSingle = String.fromCharCode(39, 39, 39);
    const tripleDouble = String.fromCharCode(34, 34, 34);

    while (i < text.length) {
        const c = text[i];
        const n = text[i + 1] ?? '';
        const nn = text.slice(i, i + 3);

        if (state === 'code') {
            if (mode === 'markup' && text.startsWith('<!--', i)) { state = 'markupComment'; i += 4; continue; }
            if (mode === 'python' && nn === tripleSingle) { state = 'pyTripleSingle'; i += 3; continue; }
            if (mode === 'python' && nn === tripleDouble) { state = 'pyTripleDouble'; i += 3; continue; }
            if (mode === 'python' && c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
            if (mode === 'cstyle' && c === '/' && n === '/') { state = 'lineComment'; i += 2; continue; }
            if (mode === 'cstyle' && c === '/' && n === '*') { state = 'blockComment'; i += 2; continue; }
            if (c === String.fromCharCode(39)) { state = 'single'; out += c; i++; continue; }
            if (c === String.fromCharCode(34)) { state = 'double'; out += c; i++; continue; }
            if (c === '`' && mode === 'cstyle') { state = 'template'; out += c; i++; continue; }
            out += c; i++; continue;
        }

        if (state === 'single' || state === 'double' || state === 'template') {
            out += c;
            if (c === '\\') {
                if (i + 1 < text.length) out += text[i + 1];
                i += 2;
                continue;
            }
            if ((state === 'single' && c === String.fromCharCode(39)) || (state === 'double' && c === String.fromCharCode(34)) || (state === 'template' && c === '`')) state = 'code';
            i++;
            continue;
        }

        if (state === 'lineComment') {
            if (c === '\n') { out += '\n'; state = 'code'; }
            i++;
            continue;
        }

        if (state === 'blockComment') {
            if (c === '*' && n === '/') { state = 'code'; i += 2; continue; }
            if (c === '\n') out += '\n';
            i++;
            continue;
        }

        if (state === 'markupComment') {
            if (text.startsWith('-->', i)) { state = 'code'; i += 3; continue; }
            if (c === '\n') out += '\n';
            i++;
            continue;
        }

        if (state === 'pyTripleSingle') {
            if (text.startsWith(tripleSingle, i)) { state = 'code'; i += 3; continue; }
            if (c === '\n') out += '\n';
            i++;
            continue;
        }

        if (state === 'pyTripleDouble') {
            if (text.startsWith(tripleDouble, i)) { state = 'code'; i += 3; continue; }
            if (c === '\n') out += '\n';
            i++;
            continue;
        }
    }
    return out;
}

function skeletonizeCode(text: string, ext: string): string {
    const lines = stripCommentsSyntaxAware(text, ext).split(/\r?\n/);
    const keep: string[] = [];
    const cStyle = ['js','jsx','ts','tsx','java','kt','kts','scala','cs','go','rs','c','h','cpp','cc','cxx','hpp','swift','php','dart'].includes(ext);
    const python = ['py','pyi'].includes(ext);

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (python) {
            if (/^(from\s+\S+\s+import|import\s+\S+)/.test(trimmed) ||
                /^(class|def|async\s+def)\s+[\w_]+/.test(trimmed) ||
                /^[A-Z_][A-Za-z0-9_]*\s*=/.test(trimmed) ||
                /^@[\w_.]+/.test(trimmed)) {
                keep.push(line.replace(/:\s*$/, ': ...'));
            }
            continue;
        }

        if (cStyle) {
            if (/^(import|export\s+from|using|namespace|package)\b/.test(trimmed) ||
                /^(export\s+)?(interface|type|enum|class|struct|record|trait|impl)\b/.test(trimmed) ||
                /\b(function|fn|func)\s+[A-Za-z_$][\w$]*/.test(trimmed) ||
                /^(export\s+)?(const|let|var)\s+[A-Za-z_$][\w$]*\s*[:=]/.test(trimmed) ||
                /^[\w<>\[\],\s:*&]+\s+[A-Za-z_$][\w$]*\s*\([^;]*\)\s*[{;]?$/.test(trimmed)) {
                keep.push(line.replace(/\{\s*$/, '{ /* ... */ }'));
            }
            continue;
        }

        if (/^(<script|<template|<style|class |function |export |import )/.test(trimmed)) keep.push(line);
    }

    return keep.length ? keep.join('\n').trimEnd() + '\n' : stripCommentsSyntaxAware(text, ext);
}

function condenseText(text: string, path: string, options: DumpOptions): { text: string; changed: boolean } {
    const before = text;
    const ext = (path.split('.').pop() || '').toLowerCase();
    let output = text;
    const mode = options.astCondensationMode === 'off' && options.condenseCode ? 'comments' : options.astCondensationMode;
    if (mode === 'skeleton') {
        output = skeletonizeCode(text, ext);
    } else if (mode === 'comments') {
        output = stripCommentsSyntaxAware(text, ext);
    }
    output = output.replace(/[ \t]+$/gm, '');
    output = output.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
    return { text: output, changed: output !== before };
}

interface TreeNode { name: string; children: Map<string, TreeNode>; file: boolean; }

function buildRepoMap(paths: string[]): string {
    const root: TreeNode = { name: '.', children: new Map(), file: false };
    for (const path of paths) {
        let current = root;
        const parts = path.split('/').filter(Boolean);
        parts.forEach((part, index) => {
            let child = current.children.get(part);
            if (!child) {
                child = { name: part, children: new Map(), file: index === parts.length - 1 };
                current.children.set(part, child);
            }
            if (index === parts.length - 1) child.file = true;
            current = child;
        });
    }
    const draw = (node: TreeNode, prefix = ''): string[] => {
        const children = Array.from(node.children.values()).sort((a, b) => {
            if (a.file !== b.file) return a.file ? 1 : -1;
            return a.name.localeCompare(b.name);
        });
        return children.flatMap((child, index) => {
            const last = index === children.length - 1;
            const line = `${prefix}${last ? '└── ' : '├── '}${child.name}${child.file ? '' : '/'}`;
            return [line, ...draw(child, `${prefix}${last ? '    ' : '│   '}`)];
        });
    };
    return ['.', ...draw(root)].join('\n');
}

function headerForFormat(zipName: string, options: DumpOptions, generatedAt: string, repoMap: string | null, part?: { index: number; total?: number }): string {
    const partLabel = part ? ` Part ${part.index}${part.total ? ` of ${part.total}` : ''}` : '';
    if (options.outputFormat === 'xml') {
        const repo = repoMap ? `  <repoMap><![CDATA[${repoMap.replaceAll(']]>', ']]]]><![CDATA[>')}]]></repoMap>\n` : '';
        return `<?xml version="1.0" encoding="UTF-8"?>\n<documents project="${escapeXml(zipName)}" generatedAt="${escapeXml(generatedAt)}" part="${escapeXml(partLabel.trim() || 'single')}">\n${repo}`;
    }
    if (options.outputFormat === 'json') return '';
    const mapBlock = repoMap ? `## Repository Map\n\n\`\`\`text\n${repoMap}\n\`\`\`\n\n` : '';
    return `# CodeDump${partLabel} for Project: \`${zipName}\`\n\n_Generated on ${generatedAt}_\n\nNo LLM call was made. Token/cost values are offline estimates only.\n\n${options.llmCodeReviewMode ? 'LLM Code Review Mode is enabled: generated/vendor/report/lockfile noise is filtered across languages.\n\n' : ''}${mapBlock}`;
}

function fileContentAsRecord(file: FileResult, options: DumpOptions): string {
    switch (options.outputFormat) {
        case 'xml':
            return file.skipped
                ? `  <file path="${escapeXml(file.path)}" skipped="true"><warning>${escapeXml(file.warning ?? 'Skipped')}</warning></file>\n`
                : `  <file path="${escapeXml(file.path)}" size="${file.size}"><![CDATA[${(file.rawContent ?? file.content).replaceAll(']]>', ']]]]><![CDATA[>')}]]></file>\n`;
        case 'json':
            return '';
        case 'markdown':
        default:
            return file.content;
    }
}

function composeDump(zipName: string, files: FileResult[], options: DumpOptions, generatedAt: string, repoMap: string | null): string {
    if (options.outputFormat === 'json') {
        return JSON.stringify({
            project: zipName,
            generatedAt,
            noLlmCallMade: true,
            llmCodeReviewMode: options.llmCodeReviewMode,
            repoMap,
            files: files.map(f => ({ path: f.path, size: f.size, skipped: Boolean(f.skipped), warning: f.warning, warnings: f.warnings, redactionCount: f.redactionCount ?? 0, promptInjectionCount: f.promptInjectionCount ?? 0, condensed: Boolean(f.condensed), tokenCount: f.tokenCount ?? 0, content: f.skipped ? undefined : (f.rawContent ?? f.content) })),
        }, null, 2);
    }
    if (options.outputFormat === 'xml') {
        const records = files.map(file => fileContentAsRecord(file, options)).join('');
        return `${headerForFormat(zipName, options, generatedAt, repoMap)}${records}</documents>\n`;
    }
    return headerForFormat(zipName, options, generatedAt, repoMap) + files.map(f => f.content).join('');
}

function countTokens(content: string, options: DumpOptions): number {
    if (options.tokenizerMode === 'estimate') return Math.ceil(content.length / 4);
    if (options.tokenizerMode === 'claude') return Math.ceil(content.split(/(\s+|[()[\]{}.,;:"'`<>/+*=\\|-])/).filter(Boolean).length * 0.78);
    try {
        const enc = getEncoding('cl100k_base');
        try {
            return enc.encode(content).length;
        } finally {
            (enc as { free?: () => void }).free?.();
        }
    } catch {
        return Math.ceil(content.length / 4);
    }
}

function makePartFilename(baseName: string, format: DumpOptions['outputFormat'], index: number): string {
    const extension = format === 'xml' ? 'xml' : format === 'json' ? 'json' : 'md';
    const normalized = baseName.replace(/\.zip$/i, '').replace(/[^\w.-]+/g, '_') || 'codedump';
    return `${normalized}_part${String(index).padStart(3, '0')}.${extension}`;
}

function semanticGroupKey(path: string): string {
    const clean = path.replace(/\\/g, '/');
    const parts = clean.split('/');
    const file = parts.pop() ?? clean;
    const dir = parts.join('/');
    const stem = file
        .replace(/\.(test|spec)\.[^.]+$/i, '')
        .replace(/\.[^.]+$/i, '')
        .toLowerCase();

    if (/^(readme|architecture|design|implementation|security|contributing|changelog|license)([._-]|$)/i.test(file)) return `00-docs/${stem}`;
    if (/^(package|cargo|pyproject|requirements|go\.mod|pom|build\.gradle|composer|gemfile|mix|stack|cabal|deno|bun|tsconfig|vite|webpack|rollup|tailwind|postcss|dockerfile)/i.test(file)) return `01-config/${stem}`;
    if (/(\.test|\.spec)\.[^.]+$/i.test(file) || /(^|\/)(tests?|__tests__|spec)\//i.test(clean)) return `${dir || 'tests'}/${stem}`;
    return `${dir || '.'}/${stem}`;
}

function groupFilesForSemanticChunking(files: FileResult[]): FileResult[][] {
    const groups = new Map<string, FileResult[]>();
    for (const file of files) {
        const key = semanticGroupKey(file.path);
        const existing = groups.get(key);
        if (existing) existing.push(file);
        else groups.set(key, [file]);
    }

    return Array.from(groups.values()).sort((a, b) => {
        const ka = semanticGroupKey(a[0]?.path ?? '');
        const kb = semanticGroupKey(b[0]?.path ?? '');
        return ka.localeCompare(kb);
    });
}

function splitIntoParts(zipName: string, files: FileResult[], options: DumpOptions, generatedAt: string, repoMap: string | null): DumpPart[] {
    const maxTokens = options.maxTokensPerFile && options.maxTokensPerFile > 0 ? options.maxTokensPerFile : null;
    const full = composeDump(zipName, files, options, generatedAt, repoMap);
    const fullTokens = countTokens(full, options);
    if (!maxTokens || fullTokens <= maxTokens) return [{ filename: makePartFilename(zipName, options.outputFormat, 1), content: full, tokenCount: fullTokens, fileCount: files.length }];

    const partFilesList: FileResult[][] = [];
    let current: FileResult[] = [];
    const units = options.semanticChunking ? groupFilesForSemanticChunking(files) : files.map(file => [file]);

    const flush = () => {
        if (current.length > 0) {
            partFilesList.push(current);
            current = [];
        }
    };

    for (const group of units) {
        const testFiles = [...current, ...group];
        const testContent = composeDump(zipName, testFiles, options, generatedAt, repoMap);
        const testTokens = countTokens(testContent, options);

        if (current.length > 0 && testTokens > maxTokens) flush();

        const groupOnlyContent = composeDump(zipName, group, options, generatedAt, repoMap);
        const groupOnlyTokens = countTokens(groupOnlyContent, options);
        if (groupOnlyTokens > maxTokens && group.length > 1) {
            // A directory/basename cluster is itself too large; split internally rather than silently exceeding every chunk.
            for (const file of group) {
                const singleTest = composeDump(zipName, [...current, file], options, generatedAt, repoMap);
                if (current.length > 0 && countTokens(singleTest, options) > maxTokens) flush();
                current.push(file);
            }
            continue;
        }

        current.push(...group);
    }
    flush();

    const parts: DumpPart[] = [];
    for (let index = 0; index < partFilesList.length; index++) {
        const partFiles = partFilesList[index];
        const content = options.outputFormat === 'markdown'
            ? headerForFormat(zipName, options, generatedAt, repoMap, { index: index + 1, total: partFilesList.length }) + partFiles.map(f => f.content).join('')
            : composeDump(zipName, partFiles, options, generatedAt, repoMap);
        parts.push({ filename: makePartFilename(zipName, options.outputFormat, index + 1), content, tokenCount: countTokens(content, options), fileCount: partFiles.length });
    }
    return parts;
}


export async function inspectZip(file: File | ArrayBuffer, options: Pick<DumpOptions, 'security'>): Promise<ZipInspection> {
    const zip = await JSZip.loadAsync(file);
    const warnings: string[] = [];
    const entries: ZipEntryInfo[] = [];
    let totalUncompressedBytes = 0;
    let totalCompressedBytes = 0;
    let fileCount = 0;

    for (const entry of Object.values(zip.files) as any[]) {
        const rawName = String(entry.name ?? '');
        const path = sanitizeZipPath(rawName, options.security.maxPathLength);
        if (path !== rawName.replace(/\\/g, '/')) warnings.push(`Sanitized unsafe ZIP path: ${rawName} -> ${path}`);
        const symlink = !entry.dir && isZipEntrySymlink(entry);
        if (symlink) warnings.push(`Dropped symbolic link entry to prevent traversal or local-file confusion: ${path}`);
        const size = entry.dir || symlink ? 0 : getUncompressedSize(entry);
        const compressedSize = entry.dir || symlink ? 0 : getCompressedSize(entry);
        totalUncompressedBytes += size;
        totalCompressedBytes += compressedSize;
        if (!entry.dir && !symlink) fileCount++;
        entries.push({ path, name: path.split('/').pop() ?? path, dir: Boolean(entry.dir), size, compressedSize, modified: formatDatetime(entry.date), unsafeOriginalName: rawName === path ? undefined : rawName, symlink });
    }

    const ratio = totalCompressedBytes > 0 ? totalUncompressedBytes / totalCompressedBytes : 0;
    if (fileCount > options.security.maxFileCount) warnings.push(`ZIP contains ${fileCount} files; limit is ${options.security.maxFileCount}.`);
    if (totalUncompressedBytes > options.security.maxTotalUncompressedBytes) warnings.push(`ZIP expands to ${totalUncompressedBytes} bytes; limit is ${options.security.maxTotalUncompressedBytes}.`);
    if (ratio > options.security.maxCompressionRatio) warnings.push(`ZIP compression ratio ${ratio.toFixed(1)} exceeds limit ${options.security.maxCompressionRatio}.`);

    const gitignoreText = await readSmallTextFile(zip, ['.gitignore'], 256 * 1024);
    const dockerignoreText = await readSmallTextFile(zip, ['.dockerignore'], 256 * 1024);
    const gitignoreRules = gitignoreText ? parseIgnoreFile(gitignoreText) : [];
    const dockerignoreRules = dockerignoreText ? parseIgnoreFile(dockerignoreText) : [];
    if (gitignoreRules.length) warnings.push(`Loaded ${gitignoreRules.length} .gitignore rule(s).`);
    if (dockerignoreRules.length) warnings.push(`Loaded ${dockerignoreRules.length} .dockerignore rule(s).`);

    const normalizedPaths = new Set(entries.filter(e => !e.dir).map(e => e.path));
    const detected = detectPreset(normalizedPaths);
    if (detected.stack) warnings.push(`Detected project stack: ${detected.stack}.`);

    return { entries: entries.sort((a, b) => a.path.localeCompare(b.path)), totalUncompressedBytes, totalCompressedBytes, fileCount, blocked: warnings.some(w => w.includes('limit') || w.includes('exceeds')), warnings, gitignoreRules, dockerignoreRules, detectedPreset: detected.preset, detectedStack: detected.stack };
}

function skippedFileResult(safePath: string, size: number, modified: string, options: DumpOptions, warning: string): FileResult {
    const metadata = { path: safePath, size, modified };
    return { path: safePath, size, skipped: true, warning, warnings: [warning], content: markdownFile(metadata, '', '', options, [`- ${warning}`]) };
}

async function processExtractedFile(
    safePath: string,
    dataUint8: Uint8Array,
    declaredSize: number,
    compressedSize: number,
    modified: string,
    options: DumpOptions
): Promise<FileResult> {
    const data = dataUint8.buffer.slice(dataUint8.byteOffset, dataUint8.byteOffset + dataUint8.byteLength);
    const metadata = { path: safePath, size: dataUint8.byteLength, modified };
    const warnings: string[] = [];

    if (options.maxSize !== null && dataUint8.byteLength > options.maxSize) {
        return skippedFileResult(safePath, dataUint8.byteLength, modified, options, `Skipped: Streamed file is larger than max size (${options.maxSize} bytes).`);
    }

    if (compressedSize > 0 && dataUint8.byteLength / compressedSize > options.security.maxSingleFileInflationRatio && dataUint8.byteLength > 1024 * 1024) {
        return skippedFileResult(safePath, dataUint8.byteLength, modified, options, `Skipped: Actual per-file compression ratio ${(dataUint8.byteLength / compressedSize).toFixed(1)} exceeds ${options.security.maxSingleFileInflationRatio}.`);
    }

    if (declaredSize > 0 && dataUint8.byteLength > Math.max(declaredSize * 1.05, declaredSize + 1024)) {
        throw new Error(`ZIP stream size mismatch: ${safePath} declared ${declaredSize} bytes but streamed ${dataUint8.byteLength} bytes.`);
    }

    if (looksLikeNestedZip(dataUint8)) {
        const warning = 'Nested ZIP/archive payload skipped; recursive archive scanning is disabled by policy.';
        return { path: safePath, size: dataUint8.byteLength, skipped: true, warning, warnings: [warning], content: markdownFile(metadata, '', '', options, [`- ${warning}`]) };
    }

    if (isProbablyBinary(dataUint8)) {
        switch (options.binaryMode) {
            case "skip": {
                const warning = `Binary file skipped (mode: skip).`;
                return { path: safePath, size: dataUint8.byteLength, skipped: true, warning, warnings: [warning], content: markdownFile(metadata, '', '', options, [`- ${warning}`]) };
            }
            case "hex": return { path: safePath, size: dataUint8.byteLength, content: markdownFile(metadata, toHex(data), 'text', options, ['- Mode: hex']) };
            case "base64": return { path: safePath, size: dataUint8.byteLength, content: markdownFile(metadata, toBase64(data), 'text', options, ['- Mode: base64']) };
            case "bytes": {
                const snippet = new TextDecoder('iso-8859-1').decode(dataUint8.slice(0, 65536));
                const more = dataUint8.byteLength > 65536 ? '... (truncated)' : '';
                return { path: safePath, size: dataUint8.byteLength, content: markdownFile(metadata, `${snippet}${more}`, 'text', options, ['- Mode: bytes']) };
            }
        }
    }

    let text = decodeText(dataUint8, options.strictText);
    if (text === null) {
        const warning = `Warning: Text decoding failed (strict mode is on). File skipped.`;
        return { path: safePath, size: dataUint8.byteLength, skipped: true, warning, warnings: [warning], content: markdownFile(metadata, '', '', options, [`- ${warning}`]) };
    }

    let redactionCount = 0;
    let promptInjectionCount = 0;
    let promptInjectionDecodedCount = 0;
    let customRuleMatchCount = 0;
    if (options.secretScanning) {
        const redacted = redactSecrets(text, options);
        text = redacted.text;
        redactionCount = redacted.count;
        customRuleMatchCount += redacted.customCount;
        warnings.push(...redacted.warnings);
    }

    if (options.promptInjectionScanning) {
        const injection = scanPromptInjection(text, safePath, options);
        promptInjectionCount = injection.count;
        promptInjectionDecodedCount = injection.decodedCount;
        customRuleMatchCount += injection.customCount;
        warnings.push(...injection.warnings);
        if (injection.skip) {
            const warning = `Skipped: Prompt-injection-like instructions detected and action is skip.`;
            return { path: safePath, size: dataUint8.byteLength, skipped: true, warning, warnings: [...warnings, warning], content: markdownFile(metadata, '', '', options, [`- ${warning}`]), promptInjectionCount, promptInjectionDecodedCount, redactionCount, customRuleMatchCount };
        }
        text = injection.text;
    }

    let condensed = false;
    if (options.condenseCode || options.astCondensationMode !== 'off') {
        const condensedResult = condenseText(text, safePath, options);
        text = condensedResult.text;
        condensed = condensedResult.changed;
        if (condensed) warnings.push(`Code condensed: ${options.astCondensationMode === 'skeleton' ? 'syntax skeleton extracted' : 'comments/empty-line noise stripped'}`);
    }

    const detailWarnings = [
        ...(redactionCount ? [`- Warning: ${redactionCount} secret-like value(s) redacted`] : []),
        ...(promptInjectionCount ? [`- Warning: ${promptInjectionCount} prompt-injection-like phrase(s) ${options.promptInjectionAction === 'redact' ? 'redacted' : 'detected'}`] : []),
        ...(promptInjectionDecodedCount ? [`- Warning: ${promptInjectionDecodedCount} prompt-injection finding(s) were found in decoded Base64 and redacted at source`] : []),
        ...(condensed ? [`- Condensed: ${options.astCondensationMode === 'skeleton' ? 'syntax skeleton' : 'comments and repeated blank lines reduced'}`] : []),
    ];

    const outputSize = TEXT_ENCODER.encode(text).byteLength;
    const tokenCount = countTokens(text, options);
    if (options.outputFormat === 'markdown') return { path: safePath, size: outputSize, content: markdownFile(metadata, text, guessLanguage(safePath), options, detailWarnings), rawContent: text, warnings, redactionCount, promptInjectionCount, promptInjectionDecodedCount, condensed, tokenCount, customRuleMatchCount };
    return { path: safePath, size: outputSize, content: text, rawContent: text, warnings, redactionCount, promptInjectionCount, promptInjectionDecodedCount, condensed, tokenCount, customRuleMatchCount };
}


function effectiveOptionsFromInspection(options: DumpOptions, inspection: ZipInspection): DumpOptions {
    let include = [...options.include];
    let exclude = [...options.exclude];

    if (options.llmCodeReviewMode) {
        include = mergeUniquePatterns(include, LLM_CODE_REVIEW_INCLUDES);
        exclude = mergeUniquePatterns(exclude, LLM_CODE_REVIEW_EXCLUDES);
    }

    if (options.useGitignore) exclude = applyIgnoreRulesToExcludes(exclude, inspection.gitignoreRules);
    if (options.useDockerignore) exclude = applyIgnoreRulesToExcludes(exclude, inspection.dockerignoreRules);

    return { ...options, include, exclude };
}

function normalizeReviewFocusPaths(values: string[]): Set<string> {
    const out = new Set<string>();
    for (const raw of values) {
        const lines = raw.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const diffMatch = trimmed.match(/^(?:\+\+\+|---)\s+[ab]\/(.+)$/) || trimmed.match(/^diff --git a\/(.+?) b\//);
            const path = diffMatch ? diffMatch[1] : trimmed.replace(/^[ab]\//, '');
            if (!path.startsWith('@@') && !path.startsWith('#')) out.add(sanitizeZipPath(path));
        }
    }
    return out;
}

function isReviewFocusRelated(path: string, focus: Set<string>): boolean {
    if (focus.size === 0) return true;
    if (focus.has(path)) return true;
    const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
    const basename = path.split('/').pop() ?? path;
    const stem = basename.replace(/\.(test|spec)\.[^.]+$/i, '').replace(/\.[^.]+$/i, '');
    for (const target of focus) {
        const targetDir = target.includes('/') ? target.substring(0, target.lastIndexOf('/')) : '';
        const targetBase = target.split('/').pop() ?? target;
        const targetStem = targetBase.replace(/\.(test|spec)\.[^.]+$/i, '').replace(/\.[^.]+$/i, '');
        if (path === target) return true;
        if (dir && dir === targetDir && (stem === targetStem || basename.startsWith(targetStem) || targetBase.startsWith(stem))) return true;
    }
    return false;
}


export async function createCodeDump(zipInput: File | ArrayBuffer, options: DumpOptions, onProgress: (percent: number, message?: string) => void, signal?: AbortSignal, zipName = (typeof File !== 'undefined' && zipInput instanceof File) ? zipInput.name : 'archive.zip'): Promise<DumpResult> {
    const patternProblems = [...validateGlobList(options.include, options), ...validateGlobList(options.exclude, options)];
    if (patternProblems.length) throw new Error(`Unsafe glob pattern blocked: ${patternProblems.join('; ')}`);

    const inspection = await inspectZip(zipInput, options);
    if (inspection.blocked) throw new Error(`ZIP blocked by safety limits: ${inspection.warnings.join(' ')}`);

    const effectiveOptions = effectiveOptionsFromInspection(options, inspection);
    const zip = await JSZip.loadAsync(zipInput);
    const selected = effectiveOptions.selectedPaths ? new Set(effectiveOptions.selectedPaths) : null;
    const reviewFocus = normalizeReviewFocusPaths(effectiveOptions.reviewFocusPaths ?? []);
    const safeByRaw = new Map<string, string>();
    for (const item of inspection.entries) if (item.unsafeOriginalName) safeByRaw.set(item.unsafeOriginalName, item.path);

    const filesToProcess = (Object.values(zip.files) as any[]).filter(file => {
        if (file.dir || isZipEntrySymlink(file)) return false;
        const safePath = safeByRaw.get(file.name) ?? sanitizeZipPath(file.name, effectiveOptions.security.maxPathLength);
        if (selected && !selected.has(safePath)) return false;
        if (!isReviewFocusRelated(safePath, reviewFocus)) return false;
        if (effectiveOptions.llmCodeReviewMode && isLlmCodeReviewNeverInclude(safePath)) return false;
        return !shouldSkip(safePath, effectiveOptions.include, effectiveOptions.exclude, effectiveOptions);
    });

    const safePathFor = (file: any) => safeByRaw.get(file.name) ?? sanitizeZipPath(file.name, effectiveOptions.security.maxPathLength);
    if (effectiveOptions.llmCodeReviewMode) {
        sortForLlmCodeReview(filesToProcess, safePathFor);
    } else {
        filesToProcess.sort((a: any, b: any) => {
            const aPath = safePathFor(a);
            const bPath = safePathFor(b);
            switch (effectiveOptions.sort) {
                case 'size': return getUncompressedSize(a) - getUncompressedSize(b) || aPath.localeCompare(bPath);
                case 'time': return ((a.date ?? DEFAULT_DATE).getTime() - (b.date ?? DEFAULT_DATE).getTime()) || aPath.localeCompare(bPath);
                case 'path':
                default: return aPath.localeCompare(bPath);
            }
        });
    }

    onProgress(1, 'Streaming ZIP extraction with byte guards...');
    const targetPaths = new Set(filesToProcess.map(file => safePathFor(file)));
    const declaredSizeBySafePath = new Map<string, number>();
    for (const file of filesToProcess) {
        declaredSizeBySafePath.set(safePathFor(file), getUncompressedSize(file));
    }
    const streamedPayloads = await extractSelectedFilesStreaming(zipInput, targetPaths, declaredSizeBySafePath, effectiveOptions, signal);

    const results: FileResult[] = [];
    const total = Math.max(filesToProcess.length, 1);
    let processedBytes = 0;

    for (let i = 0; i < filesToProcess.length; i++) {
        if (signal?.aborted) throw new DOMException('Processing cancelled', 'AbortError');
        const file = filesToProcess[i];
        const safePath = safePathFor(file);
        const payload = streamedPayloads.get(safePath);
        if (!payload) {
            const warning = `Skipped: ZIP streaming extractor did not emit file payload.`;
            results.push(skippedFileResult(safePath, getUncompressedSize(file), formatDatetime(file.date), effectiveOptions, warning));
            continue;
        }
        const result = await processExtractedFile(safePath, payload.data, getUncompressedSize(file) || payload.declaredSize, getCompressedSize(file), formatDatetime(file.date), effectiveOptions);
        results.push(result);
        processedBytes += result.size;
        if (processedBytes > effectiveOptions.security.maxTotalUncompressedBytes) throw new Error(`ZIP extraction exceeded maxTotalUncompressedBytes during processing (${processedBytes}).`);
        onProgress(Math.round(((i + 1) / total) * 100), safePath);
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    const generatedAt = new Date().toISOString();
    const includedPaths = results.filter(r => !r.skipped).map(r => r.path);
    const repoMap = effectiveOptions.includeRepoMap ? buildRepoMap(includedPaths) : null;
    const parts = splitIntoParts(zipName, results, effectiveOptions, generatedAt, repoMap);
    const content = parts.length === 1
        ? parts[0].content
        : `# Chunked CodeDump for Project: \`${zipName}\`\n\nThis dump was split into ${parts.length} files because maxTokensPerFile is ${effectiveOptions.maxTokensPerFile}.\n\nNo LLM call was made. Download exports all parts as a ZIP.\n\n` + parts.map(part => `- ${part.filename}: ${part.tokenCount} tokens, ${part.fileCount} files`).join('\n') + '\n';
    const tokenCount = parts.reduce((sum, part) => sum + part.tokenCount, 0);
    const estimatedCostUsd = (tokenCount / 1_000_000) * effectiveOptions.modelPricingInputPerMillion;
    const fileWarnings = results.flatMap(r => (r.warnings ?? []).map(w => `${r.path}: ${w}`));
    const warnings = [...inspection.warnings, 'Streaming ZIP extraction enabled: selected files are inflated in guarded chunks with actual byte limits.', ...(reviewFocus.size ? [`Diff/Review Focus Mode enabled: ${reviewFocus.size} changed path(s) plus same-directory siblings considered.`] : []), ...(effectiveOptions.semanticChunking ? ['Semantic chunking enabled: files are grouped by directory/basename/test relationship before token splitting.'] : []), ...(effectiveOptions.llmCodeReviewMode ? ['LLM Code Review Mode enabled: lockfiles, generated outputs, reports, data dumps, vendored dependencies and media artifacts were filtered before extraction.'] : []), ...fileWarnings];

    return {
        content,
        files: results,
        parts,
        warnings,
        stats: {
            fileCount: results.filter(r => !r.skipped).length,
            skippedCount: results.filter(r => r.skipped).length,
            byteCount: results.reduce((sum, r) => sum + r.size, 0),
            tokenCount,
            estimatedCostUsd,
            outputFormat: effectiveOptions.outputFormat,
            chunkCount: parts.length,
            redactionCount: results.reduce((sum, r) => sum + (r.redactionCount ?? 0), 0),
            promptInjectionCount: results.reduce((sum, r) => sum + (r.promptInjectionCount ?? 0), 0),
            condensedFileCount: results.filter(r => r.condensed).length,
            promptInjectionDecodedCount: results.reduce((sum, r) => sum + (r.promptInjectionDecodedCount ?? 0), 0),
            highEntropyRedactionCount: results.reduce((sum, r) => sum + (r.warnings ?? []).filter(w => w.includes('high-entropy')).length, 0),
            customRuleMatchCount: results.reduce((sum, r) => sum + (r.customRuleMatchCount ?? 0), 0),
        },
    };
}
