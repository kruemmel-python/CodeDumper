import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const translations = {
    en: {
        'app.title': 'CodeDump from ZIP',
        'app.subtitle': 'Generate a comprehensive Markdown file from your project\'s ZIP archive.',
        'app.selectedFile': 'Selected: {filename}',
        'app.generate': 'Generate CodeDump',
        'app.invalidZip': 'Please select a valid ZIP file.',
        'app.noZip': 'Please select a ZIP file first.',
        'app.error': 'An error occurred: {message}',
        'loading.processing': 'Processing ZIP file...',
        'loading.percentComplete': '{percent}% complete',
        'options.configuration': 'Configuration',
        'options.preset': 'Preset',
        'options.preset.custom': 'Custom',
        'options.include.label': 'Include Patterns (one per line)',
        'options.include.placeholder': '**/*.js\n**/*.tsx',
        'options.exclude.label': 'Exclude Patterns (one per line)',
        'options.exclude.placeholder': '**/node_modules/**\n**/dist/**',
        'options.maxSize.label': 'Max File Size (bytes)',
        'options.maxSize.placeholder': 'e.g., 1000000 for 1MB',
        'options.binaryMode.label': 'Binary Files',
        'options.binaryMode.skip': 'Skip',
        'options.binaryMode.hex': 'Hex',
        'options.binaryMode.base64': 'Base64',
        'options.binaryMode.bytes': 'Bytes',
        'options.sort.label': 'Sort By',
        'options.sort.path': 'Path',
        'options.sort.size': 'Size',
        'options.sort.time': 'Time',
        'options.showMetadata': 'Show File Metadata',
        'options.strictText': 'Strict Text Decoding',
        'output.title': 'Generated CodeDump',
        'output.copy': 'Copy',
        'output.download': 'Download',
        'output.newDump': 'New Dump',
        'fileUpload.callToAction': 'Upload a ZIP file',
        'fileUpload.orDragDrop': 'or drag and drop',
        'fileUpload.hint': 'ZIP archive of your project',
        'language.selector': 'Language',
        'language.en': 'English',
        'language.de': 'Deutsch',
        'presets.llm-code-review': 'LLM Code Review',
        'presets.full-stack': 'Full Stack',
        'presets.python-web': 'Python Web',
        'presets.react': 'React',
        'presets.node-app': 'Node App',
        'presets.data-science': 'Data Science',
        'presets.rust-crate': 'Rust Crate',
        'presets.java-maven': 'Java Maven',
        'presets.dotnet': '.NET'
    },
    de: {
        'app.title': 'CodeDump aus ZIP',
        'app.subtitle': 'Erzeuge eine umfassende Markdown-Datei aus dem ZIP-Archiv deines Projekts.',
        'app.selectedFile': 'Ausgewählt: {filename}',
        'app.generate': 'CodeDump erstellen',
        'app.invalidZip': 'Bitte wähle eine gültige ZIP-Datei aus.',
        'app.noZip': 'Bitte wähle zuerst eine ZIP-Datei aus.',
        'app.error': 'Es ist ein Fehler aufgetreten: {message}',
        'loading.processing': 'ZIP-Datei wird verarbeitet...',
        'loading.percentComplete': '{percent}% abgeschlossen',
        'options.configuration': 'Konfiguration',
        'options.preset': 'Voreinstellung',
        'options.preset.custom': 'Benutzerdefiniert',
        'options.include.label': 'Einschlussmuster (je Zeile eines)',
        'options.include.placeholder': '**/*.js\n**/*.tsx',
        'options.exclude.label': 'Ausschlussmuster (je Zeile eines)',
        'options.exclude.placeholder': '**/node_modules/**\n**/dist/**',
        'options.maxSize.label': 'Maximale Dateigröße (Bytes)',
        'options.maxSize.placeholder': 'z. B. 1000000 für 1 MB',
        'options.binaryMode.label': 'Binärdateien',
        'options.binaryMode.skip': 'Überspringen',
        'options.binaryMode.hex': 'Hexadezimal',
        'options.binaryMode.base64': 'Base64',
        'options.binaryMode.bytes': 'Bytes',
        'options.sort.label': 'Sortieren nach',
        'options.sort.path': 'Pfad',
        'options.sort.size': 'Größe',
        'options.sort.time': 'Zeit',
        'options.showMetadata': 'Dateimetadaten anzeigen',
        'options.strictText': 'Strikte Textdekodierung',
        'output.title': 'Erstellter CodeDump',
        'output.copy': 'Kopieren',
        'output.download': 'Herunterladen',
        'output.newDump': 'Neuer Dump',
        'fileUpload.callToAction': 'ZIP-Datei hochladen',
        'fileUpload.orDragDrop': 'oder per Drag & Drop hinzufügen',
        'fileUpload.hint': 'ZIP-Archiv deines Projekts',
        'language.selector': 'Sprache',
        'language.en': 'Englisch',
        'language.de': 'Deutsch',
        'presets.llm-code-review': 'LLM-Code-Review',
        'presets.full-stack': 'Full Stack',
        'presets.python-web': 'Python Web',
        'presets.react': 'React',
        'presets.node-app': 'Node-App',
        'presets.data-science': 'Data Science',
        'presets.rust-crate': 'Rust-Projekt',
        'presets.java-maven': 'Java Maven',
        'presets.dotnet': '.NET'
    }
} as const;

type LanguageCode = keyof typeof translations;
type TranslationKey = keyof typeof translations.en;
type TranslationValues = Record<string, string | number>;

interface TranslationContextValue {
    language: LanguageCode;
    setLanguage: (language: LanguageCode) => void;
    t: (key: TranslationKey, values?: TranslationValues) => string;
}

const TranslationContext = createContext<TranslationContextValue | undefined>(undefined);

function getInitialLanguage(): LanguageCode {
    if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem('language');
        if (stored === 'en' || stored === 'de') {
            return stored;
        }
        const navigatorLang = window.navigator.language.slice(0, 2);
        if (navigatorLang === 'de') {
            return 'de';
        }
    }
    return 'en';
}

export const TranslationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguage] = useState<LanguageCode>(() => getInitialLanguage());

    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem('language', language);
        }
    }, [language]);

    const translate = useCallback((key: TranslationKey, values: TranslationValues = {}) => {
        const template = translations[language][key] ?? translations.en[key] ?? key;
        return template.replace(/\{(\w+)\}/g, (_, token: string) => {
            if (token in values) {
                return String(values[token]);
            }
            return '';
        });
    }, [language]);

    const value = useMemo(() => ({ language, setLanguage, t: translate }), [language, translate]);

    return (
        <TranslationContext.Provider value={value}>
            {children}
        </TranslationContext.Provider>
    );
};

export function useTranslation(): TranslationContextValue {
    const context = useContext(TranslationContext);
    if (!context) {
        throw new Error('useTranslation must be used within a TranslationProvider');
    }
    return context;
}

export type { LanguageCode, TranslationKey };
