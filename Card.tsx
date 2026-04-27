import React from 'react';
import { DumpOptions, BinaryMode, SortMode, Preset, OutputFormat, TokenizerMode, CustomScanRule } from '../types';
import { PRESETS } from '../constants';
import { Card } from './ui/Card';
import { Label } from './ui/Label';
import { Select } from './ui/Select';
import { Input } from './ui/Input';
import { Textarea } from './ui/Textarea';
import { Checkbox } from './ui/Checkbox';
import { useTranslation, TranslationKey } from '../i18n';

const MAX_PATTERN_LENGTH_FALLBACK = 100;

function sanitizePatternInput(value: string, maxLength: number): string[] {
    return value
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.slice(0, maxLength || MAX_PATTERN_LENGTH_FALLBACK))
        .filter(line => !/\*{3,}|\+{2,}|\([^)]*[+*][^)]*\)[+*]/.test(line));
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

function parseCustomRules(value: string, maxRules: number): CustomScanRule[] {
    if (!value.trim()) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error('Custom rules must be a JSON array.');
    return parsed.slice(0, maxRules).map((item, index) => {
        const rule = item as Partial<CustomScanRule>;
        if (!rule.pattern || !rule.type) throw new Error(`Custom rule ${index + 1} must contain type and pattern.`);
        if (rule.type !== 'secret' && rule.type !== 'promptInjection') throw new Error(`Custom rule ${index + 1} has invalid type.`);
        return {
            id: String(rule.id || `custom-${index + 1}`),
            type: rule.type,
            pattern: String(rule.pattern),
            replacement: rule.replacement ? String(rule.replacement) : undefined,
            action: rule.action,
            caseSensitive: Boolean(rule.caseSensitive),
            description: rule.description ? String(rule.description) : undefined,
        };
    });
}


type PresetTranslationKey = `presets.${typeof PRESETS[number]['name']}`;

interface OptionsPanelProps {
    options: DumpOptions;
    setOptions: React.Dispatch<React.SetStateAction<DumpOptions>>;
    onPresetChange: (preset: Preset) => void;
    disabled: boolean;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({ options, setOptions, onPresetChange, disabled }) => {
    const { t } = useTranslation();

    const handleOptionChange = <K extends keyof DumpOptions>(key: K, value: DumpOptions[K]) => {
        setOptions(prev => ({ ...prev, [key]: value }));
    };

    const handleSecurityChange = <K extends keyof DumpOptions['security']>(key: K, value: number) => {
        setOptions(prev => ({ ...prev, security: { ...prev.security, [key]: value } }));
    };

    const handlePresetSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const preset = PRESETS.find(p => p.name === e.target.value);
        if (preset) onPresetChange(preset);
    };

    const handleListChange = (key: 'include' | 'exclude', value: string) => {
        handleOptionChange(key, sanitizePatternInput(value, options.security.maxPatternLength));
    };

    const handlePatchUpload = async (file: File | null) => {
        if (!file) return;
        const text = await file.text();
        const paths = parseFocusPathsFromPatchText(text);
        handleOptionChange('reviewFocusPaths', paths);
    };

    const handleCustomRulesChange = (value: string) => {
        try {
            handleOptionChange('customRules', parseCustomRules(value, options.security.maxCustomRules));
        } catch {
            // Keep the editor usable while the JSON is incomplete; invalid rules simply do not enter the processing pipeline.
            handleOptionChange('customRules', []);
        }
    };

    return (
        <Card className="h-full overflow-y-auto">
            <div className="space-y-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{t('options.configuration')}</h2>

                <div>
                    <Label htmlFor="preset">{t('options.preset')}</Label>
                    <Select id="preset" onChange={handlePresetSelect} disabled={disabled}>
                        <option value="">{t('options.preset.custom')}</option>
                        {PRESETS.map(p => {
                            const presetKey = `presets.${p.name}` as PresetTranslationKey & TranslationKey;
                            return <option key={p.name} value={p.name}>{t(presetKey)}</option>;
                        })}
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="outputFormat">Export Format</Label>
                        <Select
                            id="outputFormat"
                            value={options.outputFormat}
                            onChange={e => handleOptionChange('outputFormat', e.target.value as OutputFormat)}
                            disabled={disabled}
                        >
                            <option value="markdown">Markdown</option>
                            <option value="xml">XML Documents</option>
                            <option value="json">JSON</option>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="tokenizerMode">Token Counter</Label>
                        <Select
                            id="tokenizerMode"
                            value={options.tokenizerMode}
                            onChange={e => handleOptionChange('tokenizerMode', e.target.value as TokenizerMode)}
                            disabled={disabled}
                        >
                            <option value="openai">OpenAI cl100k_base</option>
                            <option value="claude">Claude estimator</option>
                            <option value="estimate">Fast chars/4 estimate</option>
                        </Select>
                    </div>
                </div>

                <div>
                    <Label htmlFor="modelPricingInputPerMillion">Input price per 1M tokens (USD)</Label>
                    <Input
                        id="modelPricingInputPerMillion"
                        type="number"
                        min="0"
                        step="0.01"
                        value={options.modelPricingInputPerMillion}
                        onChange={e => handleOptionChange('modelPricingInputPerMillion', Number(e.target.value) || 0)}
                        disabled={disabled}
                    />
                </div>

                <div className="rounded border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
                    Token and cost values are offline estimates only. No LLM/API call is made by CodeDump.
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="maxTokensPerFile">Max tokens per exported file</Label>
                        <Input
                            id="maxTokensPerFile"
                            type="number"
                            min="0"
                            value={options.maxTokensPerFile ?? ''}
                            onChange={e => handleOptionChange('maxTokensPerFile', e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0))}
                            placeholder="empty = single file"
                            disabled={disabled}
                        />
                    </div>
                    <div>
                        <Label htmlFor="maxPatternLength">Max glob pattern length</Label>
                        <Input
                            id="maxPatternLength"
                            type="number"
                            min="16"
                            max="500"
                            value={options.security.maxPatternLength}
                            onChange={e => handleSecurityChange('maxPatternLength', Number(e.target.value) || 100)}
                            disabled={disabled}
                        />
                    </div>
                </div>

                <div className="space-y-3 rounded border border-gray-200 dark:border-gray-800 p-3">
                    <div className="text-sm font-semibold">Enterprise Modules</div>
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950">
                        <Checkbox
                            id="llmCodeReviewMode"
                            label="LLM Code Review Mode (language-agnostic source/config focus)"
                            checked={options.llmCodeReviewMode}
                            onChange={e => handleOptionChange('llmCodeReviewMode', e.target.checked)}
                            disabled={disabled}
                        />
                        <p className="mt-2 text-xs text-emerald-900 dark:text-emerald-100">
                            Automatically excludes lockfiles, reports, generated output, vendored dependencies, data dumps and media artifacts while keeping source, tests, manifests and architecture-relevant config across Python, JS/TS, Java, .NET, Go, Rust, C/C++, PHP, Ruby, Swift, Dart and more.
                        </p>
                    </div>
                    <Checkbox id="useGitignore" label="Apply root .gitignore automatically" checked={options.useGitignore} onChange={e => handleOptionChange('useGitignore', e.target.checked)} disabled={disabled} />
                    <Checkbox id="useDockerignore" label="Apply root .dockerignore automatically" checked={options.useDockerignore} onChange={e => handleOptionChange('useDockerignore', e.target.checked)} disabled={disabled} />
                    <Checkbox id="includeRepoMap" label="Insert repository map at top of dump" checked={options.includeRepoMap} onChange={e => handleOptionChange('includeRepoMap', e.target.checked)} disabled={disabled} />
                    <Checkbox id="condenseCode" label="Condense code to reduce token footprint" checked={options.condenseCode} onChange={e => handleOptionChange('condenseCode', e.target.checked)} disabled={disabled} />
                    <div>
                        <Label htmlFor="astCondensationMode">Syntax-aware condensation mode</Label>
                        <Select
                            id="astCondensationMode"
                            value={options.astCondensationMode}
                            onChange={e => handleOptionChange('astCondensationMode', e.target.value as DumpOptions['astCondensationMode'])}
                            disabled={disabled}
                        >
                            <option value="off">Off</option>
                            <option value="comments">Remove comments safely</option>
                            <option value="skeleton">Skeleton: signatures/types only where possible</option>
                        </Select>
                    </div>
                    <Checkbox id="semanticChunking" label="Semantic chunking: keep same-directory files and tests together" checked={options.semanticChunking} onChange={e => handleOptionChange('semanticChunking', e.target.checked)} disabled={disabled} />
                    <Checkbox id="secretScanning" label="Scan and redact known secrets before export" checked={options.secretScanning} onChange={e => handleOptionChange('secretScanning', e.target.checked)} disabled={disabled} />
                    <Checkbox id="entropySecretScanning" label="Redact high-entropy custom secret candidates" checked={options.entropySecretScanning} onChange={e => handleOptionChange('entropySecretScanning', e.target.checked)} disabled={disabled || !options.secretScanning} />
                    <Checkbox id="promptInjectionScanning" label="Detect indirect prompt-injection phrases in code/comments" checked={options.promptInjectionScanning} onChange={e => handleOptionChange('promptInjectionScanning', e.target.checked)} disabled={disabled} />
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label htmlFor="promptInjectionAction">Prompt-injection action</Label>
                            <Select
                                id="promptInjectionAction"
                                value={options.promptInjectionAction}
                                onChange={e => handleOptionChange('promptInjectionAction', e.target.value as DumpOptions['promptInjectionAction'])}
                                disabled={disabled || !options.promptInjectionScanning}
                            >
                                <option value="warn">Warn only</option>
                                <option value="redact">Redact phrases</option>
                                <option value="skip">Skip flagged files</option>
                            </Select>
                        </div>
                        <div>
                            <Label htmlFor="maxPromptInjectionFindings">Max injection warnings</Label>
                            <Input
                                id="maxPromptInjectionFindings"
                                type="number"
                                min="1"
                                max="200"
                                value={options.security.maxPromptInjectionFindings}
                                onChange={e => handleSecurityChange('maxPromptInjectionFindings', Number(e.target.value) || 25)}
                                disabled={disabled}
                            />
                        </div>
                    </div>
                    <div>
                        <Label htmlFor="reviewFocusPaths">Diff / Review Focus Paths</Label>
                        <Textarea
                            id="reviewFocusPaths"
                            rows={4}
                            value={options.reviewFocusPaths.join('\n')}
                            onChange={e => handleOptionChange('reviewFocusPaths', e.target.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))}
                            placeholder={"Optional: paste changed file paths or unified diff headers\nsrc/foo.ts\n+++ b/app/service.py"}
                            disabled={disabled}
                        />
                        <div className="mt-2">
                            <Label htmlFor="patchUpload">Upload .diff/.patch</Label>
                            <Input
                                id="patchUpload"
                                type="file"
                                accept=".diff,.patch,text/x-diff,text/x-patch,text/plain"
                                onChange={e => handlePatchUpload(e.target.files?.[0] ?? null)}
                                disabled={disabled}
                            />
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            When filled, the dump focuses on changed paths and same-directory companion/test files. Leave empty for a full repository review dump.
                        </p>
                    </div>
                </div>


                <details className="rounded border border-gray-200 dark:border-gray-800 p-3">
                    <summary className="cursor-pointer font-semibold">Custom Enterprise Rules</summary>
                    <div className="mt-3 space-y-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            JSON array of safe custom rules. Example: {`[{"id":"corp-token","type":"secret","pattern":"CORP_API_TKN_[A-Z0-9]{20,}","replacement":"[REDACTED_CORP_TOKEN]"}]`}
                        </p>
                        <Textarea
                            id="customRules"
                            rows={6}
                            value={JSON.stringify(options.customRules ?? [], null, 2)}
                            onChange={e => handleCustomRulesChange(e.target.value)}
                            disabled={disabled}
                        />
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label htmlFor="maxScanLineLength">Max scan line length</Label>
                                <Input id="maxScanLineLength" type="number" min="1000" value={options.security.maxScanLineLength} onChange={e => handleSecurityChange('maxScanLineLength', Number(e.target.value) || 10000)} disabled={disabled} />
                            </div>
                            <div>
                                <Label htmlFor="maxBase64DecodeBytes">Max Base64 decode bytes</Label>
                                <Input id="maxBase64DecodeBytes" type="number" min="1024" value={options.security.maxBase64DecodeBytes} onChange={e => handleSecurityChange('maxBase64DecodeBytes', Number(e.target.value) || 262144)} disabled={disabled} />
                            </div>
                        </div>
                    </div>
                </details>

                <div>
                    <Label htmlFor="include">{t('options.include.label')}</Label>
                    <Textarea
                        id="include"
                        rows={4}
                        value={options.include.join('\n')}
                        onChange={e => handleListChange('include', e.target.value)}
                        placeholder={t('options.include.placeholder')}
                        disabled={disabled}
                    />
                </div>

                <div>
                    <Label htmlFor="exclude">{t('options.exclude.label')}</Label>
                    <Textarea
                        id="exclude"
                        rows={4}
                        value={options.exclude.join('\n')}
                        onChange={e => handleListChange('exclude', e.target.value)}
                        placeholder={t('options.exclude.placeholder')}
                        disabled={disabled}
                    />
                </div>

                <div>
                    <Label htmlFor="maxSize">{t('options.maxSize.label')}</Label>
                    <Input
                        id="maxSize"
                        type="number"
                        min="0"
                        value={options.maxSize === null ? '' : options.maxSize}
                        onChange={e => handleOptionChange('maxSize', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                        placeholder={t('options.maxSize.placeholder')}
                        disabled={disabled}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="binaryMode">{t('options.binaryMode.label')}</Label>
                        <Select
                            id="binaryMode"
                            value={options.binaryMode}
                            onChange={e => handleOptionChange('binaryMode', e.target.value as BinaryMode)}
                            disabled={disabled}
                        >
                            <option value="skip">{t('options.binaryMode.skip')}</option>
                            <option value="hex">{t('options.binaryMode.hex')}</option>
                            <option value="base64">{t('options.binaryMode.base64')}</option>
                            <option value="bytes">{t('options.binaryMode.bytes')}</option>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="sort">{t('options.sort.label')}</Label>
                        <Select
                            id="sort"
                            value={options.sort}
                            onChange={e => handleOptionChange('sort', e.target.value as SortMode)}
                            disabled={disabled}
                        >
                            <option value="path">{t('options.sort.path')}</option>
                            <option value="size">{t('options.sort.size')}</option>
                            <option value="time">{t('options.sort.time')}</option>
                        </Select>
                    </div>
                </div>

                <div className="space-y-3">
                    <Checkbox
                        id="showMetadata"
                        label={t('options.showMetadata')}
                        checked={options.showMetadata}
                        onChange={e => handleOptionChange('showMetadata', e.target.checked)}
                        disabled={disabled}
                    />
                    <Checkbox
                        id="strictText"
                        label={t('options.strictText')}
                        checked={options.strictText}
                        onChange={e => handleOptionChange('strictText', e.target.checked)}
                        disabled={disabled}
                    />
                </div>

                <details className="rounded border border-gray-200 dark:border-gray-800 p-3">
                    <summary className="cursor-pointer font-semibold">Security Limits</summary>
                    <div className="mt-4 grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="maxTotalUncompressedBytes">Max expanded bytes</Label>
                            <Input
                                id="maxTotalUncompressedBytes"
                                type="number"
                                min="1"
                                value={options.security.maxTotalUncompressedBytes}
                                onChange={e => handleSecurityChange('maxTotalUncompressedBytes', Number(e.target.value) || 1)}
                                disabled={disabled}
                            />
                        </div>
                        <div>
                            <Label htmlFor="maxCompressionRatio">Max ZIP ratio</Label>
                            <Input
                                id="maxCompressionRatio"
                                type="number"
                                min="1"
                                value={options.security.maxCompressionRatio}
                                onChange={e => handleSecurityChange('maxCompressionRatio', Number(e.target.value) || 1)}
                                disabled={disabled}
                            />
                        </div>
                        <div>
                            <Label htmlFor="maxFileCount">Max files</Label>
                            <Input
                                id="maxFileCount"
                                type="number"
                                min="1"
                                value={options.security.maxFileCount}
                                onChange={e => handleSecurityChange('maxFileCount', Number(e.target.value) || 1)}
                                disabled={disabled}
                            />
                        </div>
                        <div>
                            <Label htmlFor="maxPathLength">Max path length</Label>
                            <Input
                                id="maxPathLength"
                                type="number"
                                min="32"
                                value={options.security.maxPathLength}
                                onChange={e => handleSecurityChange('maxPathLength', Number(e.target.value) || 32)}
                                disabled={disabled}
                            />
                        </div>

                        <div>
                            <Label htmlFor="workerStallTimeoutMs">Worker stall timeout ms</Label>
                            <Input
                                id="workerStallTimeoutMs"
                                type="number"
                                min="1000"
                                value={options.security.workerStallTimeoutMs}
                                onChange={e => handleSecurityChange('workerStallTimeoutMs', Number(e.target.value) || 30000)}
                                disabled={disabled}
                            />
                        </div>
                        <div>
                            <Label htmlFor="maxSingleFileInflationRatio">Max single-file ZIP ratio</Label>
                            <Input
                                id="maxSingleFileInflationRatio"
                                type="number"
                                min="1"
                                value={options.security.maxSingleFileInflationRatio}
                                onChange={e => handleSecurityChange('maxSingleFileInflationRatio', Number(e.target.value) || 20)}
                                disabled={disabled}
                            />
                        </div>
                    </div>
                </details>
            </div>
        </Card>
    );
};
