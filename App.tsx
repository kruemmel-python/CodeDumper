import React, { useCallback, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { DumpOptions, Preset, DumpResult, WorkerResponse } from './types';
import { DEFAULT_MODEL_PRICING_INPUT_PER_MILLION, DEFAULT_SECURITY_LIMITS } from './constants';
import ZipWorker from './services/zipWorker?worker';
import { OptionsPanel } from './components/OptionsPanel';
import { FileUpload } from './components/FileUpload';
import { FileTreeSelector } from './components/FileTreeSelector';
import { OutputDisplay } from './components/OutputDisplay';
import { useTranslation } from './i18n';
import { LanguageSelector } from './components/LanguageSelector';
import { Button } from './components/ui/Button';

const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);

const CopyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const defaultOptions: DumpOptions = {
    include: ['**/*'],
    exclude: [],
    maxSize: 2_000_000,
    binaryMode: 'skip',
    showMetadata: true,
    sort: 'path',
    strictText: false,
    outputFormat: 'markdown',
    tokenizerMode: 'openai',
    modelPricingInputPerMillion: DEFAULT_MODEL_PRICING_INPUT_PER_MILLION,
    selectedPaths: null,
    security: DEFAULT_SECURITY_LIMITS,
    useGitignore: true,
    useDockerignore: true,
    includeRepoMap: true,
    condenseCode: false,
    astCondensationMode: "comments",
    secretScanning: true,
    customRules: [],
    maxTokensPerFile: null,
    llmCodeReviewMode: true,
    entropySecretScanning: true,
    promptInjectionScanning: true,
    promptInjectionAction: "redact",
    semanticChunking: true,
    reviewFocusPaths: [],
    tokenTreemapEnabled: true,
};

const LoadingIndicator: React.FC<{ progress: number; status: string | null; onCancel: () => void }> = ({ progress, status, onCancel }) => {
    const { t } = useTranslation();

    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-white/50 dark:bg-gray-900/50 rounded-lg">
            <svg className="animate-spin -ml-1 mr-3 h-10 w-10 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="mt-4 text-lg font-semibold text-gray-700 dark:text-gray-200">{t('loading.processing')}</p>
            {status && <p className="mt-1 max-w-lg truncate text-sm text-gray-500 dark:text-gray-400">{status}</p>}
            <div className="w-1/2 mt-3 bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('loading.percentComplete', { percent: progress })}</p>
            <Button type="button" variant="danger" className="mt-4" onClick={onCancel}>Cancel</Button>
        </div>
    );
};

function extensionForFormat(format: DumpOptions['outputFormat']): string {
    switch (format) {
        case 'xml': return 'xml';
        case 'json': return 'json';
        case 'markdown':
        default: return 'md';
    }
}

function mimeForFormat(format: DumpOptions['outputFormat']): string {
    switch (format) {
        case 'xml': return 'application/xml;charset=utf-8';
        case 'json': return 'application/json;charset=utf-8';
        case 'markdown':
        default: return 'text/markdown;charset=utf-8';
    }
}

function App() {
    const [options, setOptions] = useState<DumpOptions>(defaultOptions);
    const [zipFile, setZipFile] = useState<File | null>(null);
    const [result, setResult] = useState<DumpResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState<string | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const jobIdRef = useRef<string | null>(null);
    const watchdogRef = useRef<number | null>(null);
    const { t } = useTranslation();

    const handlePresetChange = useCallback((preset: Preset) => {
        setOptions(prev => ({
            ...defaultOptions,
            ...preset.options,
            include: preset.options.include || [],
            exclude: preset.options.exclude || [],
            security: { ...DEFAULT_SECURITY_LIMITS, ...(preset.options.security ?? {}) },
            outputFormat: preset.options.outputFormat ?? prev.outputFormat,
            tokenizerMode: preset.options.tokenizerMode ?? prev.tokenizerMode,
            modelPricingInputPerMillion: preset.options.modelPricingInputPerMillion ?? prev.modelPricingInputPerMillion,
            selectedPaths: null,
            useGitignore: preset.options.useGitignore ?? prev.useGitignore,
            useDockerignore: preset.options.useDockerignore ?? prev.useDockerignore,
            includeRepoMap: preset.options.includeRepoMap ?? prev.includeRepoMap,
            condenseCode: preset.options.condenseCode ?? prev.condenseCode,
            secretScanning: preset.options.secretScanning ?? prev.secretScanning,
            maxTokensPerFile: preset.options.maxTokensPerFile ?? prev.maxTokensPerFile,
            llmCodeReviewMode: preset.options.llmCodeReviewMode ?? prev.llmCodeReviewMode,
        }));
    }, []);

    const handleFileSelect = useCallback((file: File) => {
        const isZip = file.type === 'application/zip' || file.type === 'application/x-zip-compressed' || /\.zip$/i.test(file.name);
        if (isZip) {
            setZipFile(file);
            setResult(null);
            setProgress(0);
            setStatus(null);
            setOptions(prev => ({ ...prev, selectedPaths: null }));
        } else {
            alert(t('app.invalidZip'));
        }
    }, [t]);

    const downloadName = useMemo(() => {
        const normalized = zipFile?.name?.replace(/\.zip$/i, '') || 'codedump';
        return `${normalized}.${extensionForFormat(options.outputFormat)}`;
    }, [zipFile, options.outputFormat]);

    const cancelWorker = useCallback(() => {
        if (watchdogRef.current !== null) {
            window.clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
        if (workerRef.current && jobIdRef.current) {
            workerRef.current.postMessage({ type: 'cancel', id: jobIdRef.current });
            workerRef.current.terminate();
            workerRef.current = null;
        }
        setIsLoading(false);
        setStatus('Cancelled');
    }, []);

    const handleGenerate = async () => {
        if (!zipFile) {
            alert(t('app.noZip'));
            return;
        }

        setIsLoading(true);
        setResult(null);
        setProgress(0);
        setStatus('Preparing worker...');

        const id = crypto.randomUUID();
        jobIdRef.current = id;

        try {
            const fileBuffer = await zipFile.arrayBuffer();
            const worker = new ZipWorker();
            workerRef.current = worker;

            const armWatchdog = () => {
                if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
                watchdogRef.current = window.setTimeout(() => {
                    worker.terminate();
                    workerRef.current = null;
                    rejectFromWatchdog?.(new Error(`Worker stalled for ${options.security.workerStallTimeoutMs} ms and was terminated.`));
                }, options.security.workerStallTimeoutMs);
            };

            let rejectFromWatchdog: ((reason?: unknown) => void) | null = null;

            await new Promise<void>((resolve, reject) => {
                rejectFromWatchdog = reject;
                armWatchdog();
                worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                    const message = event.data;
                    if (message.id !== id) return;

                    if (message.type === 'progress') {
                        setProgress(message.percent);
                        setStatus(message.message ?? null);
                        armWatchdog();
                        return;
                    }

                    if (message.type === 'done') {
                        if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
                        watchdogRef.current = null;
                        setResult(message.result);
                        resolve();
                        return;
                    }

                    if (message.type === 'error') {
                        if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current);
                        watchdogRef.current = null;
                        reject(new Error(message.message));
                    }
                };

                worker.onerror = event => {
                    reject(new Error(event.message || 'Worker execution failed'));
                };

                worker.postMessage({ type: 'process', id, fileBuffer, fileName: zipFile.name, options }, [fileBuffer]);
            });
        } catch (error) {
            console.error('Failed to process ZIP file:', error);
            const message = error instanceof Error ? error.message : 'Unknown error';
            alert(t('app.error', { message }));
            setResult(null);
        } finally {
            if (watchdogRef.current !== null) {
                window.clearTimeout(watchdogRef.current);
                watchdogRef.current = null;
            }
            workerRef.current?.terminate();
            workerRef.current = null;
            jobIdRef.current = null;
            setIsLoading(false);
            setStatus(null);
        }
    };

    const handleReset = useCallback(() => {
        cancelWorker();
        setZipFile(null);
        setResult(null);
        setIsLoading(false);
        setProgress(0);
        setStatus(null);
        setOptions(defaultOptions);
    }, [cancelWorker]);

    const handleDownload = useCallback(async () => {
        if (!result) return;

        let blob: Blob;
        let finalName = downloadName;

        if (result.parts.length > 1) {
            const archive = new JSZip();
            for (const part of result.parts) {
                archive.file(part.filename, part.content);
            }
            blob = await archive.generateAsync({ type: 'blob', compression: 'DEFLATE' });
            finalName = `${downloadName.replace(/\.[^.]+$/, '')}_parts.zip`;
        } else {
            blob = new Blob([result.parts[0]?.content ?? result.content], { type: mimeForFormat(options.outputFormat) });
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [downloadName, result, options.outputFormat]);

    const handleCopy = useCallback(() => {
        if (!result) return;
        navigator.clipboard.writeText(result.parts.length === 1 ? result.parts[0].content : result.content);
    }, [result]);

    const memoizedOptionsPanel = useMemo(() => (
        <OptionsPanel
            options={options}
            setOptions={setOptions}
            onPresetChange={handlePresetChange}
            disabled={isLoading}
        />
    ), [options, handlePresetChange, isLoading]);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-4 lg:p-8 font-sans">
            <main className="max-w-screen-2xl mx-auto">
                <header className="mb-8">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="text-center lg:text-left">
                            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white">{t('app.title')}</h1>
                            <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">{t('app.subtitle')}</p>
                        </div>
                        <LanguageSelector />
                    </div>
                </header>

                {result && !isLoading && (
                    <div className="flex flex-wrap justify-end gap-3 mb-6">
                        <Button onClick={handleCopy} variant="secondary" leftIcon={<CopyIcon />}>{t('output.copy')}</Button>
                        <Button onClick={handleDownload} variant="primary" leftIcon={<DownloadIcon />}>{t('output.download')}</Button>
                        <Button onClick={handleReset} variant="secondary">{t('output.newDump')}</Button>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-12rem)]">
                    <div className="h-full flex flex-col overflow-hidden">
                        {memoizedOptionsPanel}
                    </div>
                    <div className="h-full flex flex-col">
                        {isLoading ? (
                            <LoadingIndicator progress={progress} status={status} onCancel={cancelWorker} />
                        ) : result !== null ? (
                            <OutputDisplay content={result.content} stats={result.stats} warnings={result.warnings} files={result.files} onExcludePath={(path) => setOptions(prev => ({ ...prev, exclude: Array.from(new Set([...prev.exclude, path.includes("/") ? `${path.substring(0, path.lastIndexOf("/") + 1)}**` : path])) }))} />
                        ) : (
                            <div className="flex flex-col h-full gap-6 overflow-auto">
                                <div className="flex-shrink-0">
                                    <FileUpload onFileSelect={handleFileSelect} disabled={isLoading} />
                                </div>
                                {zipFile && (
                                    <>
                                        <FileTreeSelector file={zipFile} options={options} setOptions={setOptions} disabled={isLoading} />
                                        <div className="flex-shrink-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-4 flex justify-between items-center">
                                            <p className="text-sm font-medium truncate">{t('app.selectedFile', { filename: zipFile.name })}</p>
                                            <button
                                                onClick={handleGenerate}
                                                disabled={options.selectedPaths?.length === 0}
                                                className="px-6 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                            >
                                                {t('app.generate')}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
