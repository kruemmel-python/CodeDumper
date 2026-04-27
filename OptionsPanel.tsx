import React, { useEffect, useMemo, useState } from 'react';
import { DumpOptions, ZipEntryInfo, ZipInspection } from '../types';
import { PRESETS } from '../constants';
import { inspectZip } from '../services/zipProcessor';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

interface TreeNode {
    path: string;
    name: string;
    dir: boolean;
    size: number;
    children: Map<string, TreeNode>;
}

interface FileTreeSelectorProps {
    file: File | null;
    options: DumpOptions;
    setOptions: React.Dispatch<React.SetStateAction<DumpOptions>>;
    disabled: boolean;
}

function createRoot(): TreeNode {
    return { path: '', name: 'root', dir: true, size: 0, children: new Map() };
}

function insertEntry(root: TreeNode, entry: ZipEntryInfo): void {
    const parts = entry.path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;
        const childPath = parts.slice(0, i + 1).join('/');
        let child = current.children.get(part);
        if (!child) {
            child = {
                path: childPath,
                name: part,
                dir: isLeaf ? entry.dir : true,
                size: isLeaf ? entry.size : 0,
                children: new Map(),
            };
            current.children.set(part, child);
        }
        if (isLeaf) {
            child.dir = entry.dir;
            child.size = entry.size;
        }
        current = child;
    }
}

function collectFilePaths(node: TreeNode): string[] {
    if (!node.dir) return [node.path];
    return Array.from(node.children.values()).flatMap(collectFilePaths);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && value >= 1024; i++) {
        value /= 1024;
        unit = units[i];
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

const TreeRow: React.FC<{
    node: TreeNode;
    selected: Set<string>;
    toggleNode: (node: TreeNode, checked: boolean) => void;
    disabled: boolean;
    depth?: number;
}> = ({ node, selected, toggleNode, disabled, depth = 0 }) => {
    const [expanded, setExpanded] = useState(depth < 2);
    const filePaths = useMemo(() => collectFilePaths(node), [node]);
    const checkedCount = filePaths.filter(path => selected.has(path)).length;
    const checked = filePaths.length > 0 && checkedCount === filePaths.length;
    const indeterminate = checkedCount > 0 && checkedCount < filePaths.length;

    return (
        <div>
            <div className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: `${depth * 16}px` }}>
                {node.dir ? (
                    <button
                        type="button"
                        onClick={() => setExpanded(v => !v)}
                        className="w-5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
                        aria-label={expanded ? 'Collapse folder' : 'Expand folder'}
                    >
                        {expanded ? '▾' : '▸'}
                    </button>
                ) : (
                    <span className="w-5" />
                )}
                <input
                    type="checkbox"
                    checked={checked}
                    ref={input => {
                        if (input) input.indeterminate = indeterminate;
                    }}
                    onChange={event => toggleNode(node, event.target.checked)}
                    disabled={disabled || filePaths.length === 0}
                    className="rounded border-gray-300"
                />
                <span className={node.dir ? 'font-medium' : 'font-mono'} title={node.path}>
                    {node.dir ? '📁 ' : '📄 '}{node.name}
                </span>
                {!node.dir && <span className="ml-auto text-xs text-gray-500">{formatBytes(node.size)}</span>}
                {node.dir && <span className="ml-auto text-xs text-gray-500">{checkedCount}/{filePaths.length}</span>}
            </div>
            {node.dir && expanded && Array.from(node.children.values() as Iterable<TreeNode>).map(child => (
                <TreeRow
                    key={child.path}
                    node={child}
                    selected={selected}
                    toggleNode={toggleNode}
                    disabled={disabled}
                    depth={depth + 1}
                />
            ))}
        </div>
    );
};

export const FileTreeSelector: React.FC<FileTreeSelectorProps> = ({ file, options, setOptions, disabled }) => {
    const [inspection, setInspection] = useState<ZipInspection | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isInspecting, setIsInspecting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setInspection(null);
        setError(null);

        if (!file) return;

        setIsInspecting(true);
        inspectZip(file, { security: options.security })
            .then(result => {
                if (cancelled) return;
                setInspection(result);
                const filePaths = result.entries.filter(e => !e.dir).map(e => e.path);
                setOptions(prev => {
                    const detectedPreset = result.detectedPreset ? PRESETS.find(p => p.name === result.detectedPreset) : undefined;
                    const presetOptions = detectedPreset ? detectedPreset.options : {};
                    const extraExcludes = [
                        ...(prev.useGitignore ? result.gitignoreRules : []),
                        ...(prev.useDockerignore ? result.dockerignoreRules : []),
                    ];
                    return {
                        ...prev,
                        ...presetOptions,
                        include: presetOptions.include ?? prev.include,
                        exclude: Array.from(new Set([...(presetOptions.exclude ?? prev.exclude), ...extraExcludes])),
                        security: prev.security,
                        outputFormat: prev.outputFormat,
                        tokenizerMode: prev.tokenizerMode,
                        modelPricingInputPerMillion: prev.modelPricingInputPerMillion,
                        selectedPaths: prev.selectedPaths ?? filePaths,
                    };
                });
            })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : 'ZIP inspection failed');
            })
            .finally(() => {
                if (!cancelled) setIsInspecting(false);
            });

        return () => {
            cancelled = true;
        };
    }, [file, options.security, setOptions]);

    const root = useMemo(() => {
        const tree = createRoot();
        for (const entry of inspection?.entries ?? []) {
            insertEntry(tree, entry);
        }
        return tree;
    }, [inspection]);

    const allFilePaths = useMemo(() => inspection?.entries.filter(e => !e.dir).map(e => e.path) ?? [], [inspection]);
    const selected = useMemo(() => new Set(options.selectedPaths ?? allFilePaths), [options.selectedPaths, allFilePaths]);

    const setSelectedPaths = (paths: string[]) => {
        setOptions(prev => ({ ...prev, selectedPaths: paths }));
    };

    const toggleNode = (node: TreeNode, checked: boolean) => {
        const nodeFiles = collectFilePaths(node);
        const next = new Set(selected);
        for (const path of nodeFiles) {
            if (checked) next.add(path);
            else next.delete(path);
        }
        setSelectedPaths(Array.from(next).sort() as string[]);
    };

    if (!file) return null;

    return (
        <Card className="mt-6">
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">File Tree</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {isInspecting
                                ? 'Reading ZIP central directory...'
                                : `${selected.size}/${allFilePaths.length} files selected${inspection ? ` · ${formatBytes(inspection.totalUncompressedBytes)} expanded` : ''}`}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" variant="secondary" onClick={() => setSelectedPaths(allFilePaths)} disabled={disabled || isInspecting}>
                            All
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setSelectedPaths([])} disabled={disabled || isInspecting}>
                            None
                        </Button>
                    </div>
                </div>

                {error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
                {inspection?.warnings.length ? (
                    <div className={`rounded border p-2 text-sm ${inspection.blocked ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                        {inspection.warnings.map(w => <div key={w}>{w}</div>)}
                    </div>
                ) : null}

                <div className="max-h-80 overflow-auto rounded border border-gray-200 dark:border-gray-800 p-2">
                    {isInspecting ? (
                        <div className="text-sm text-gray-500">Inspecting archive...</div>
                    ) : (
                        Array.from(root.children.values() as Iterable<TreeNode>).map(child => (
                            <TreeRow
                                key={child.path}
                                node={child}
                                selected={selected}
                                toggleNode={toggleNode}
                                disabled={disabled || Boolean(inspection?.blocked)}
                            />
                        ))
                    )}
                </div>
            </div>
        </Card>
    );
};
