
import React, { useState, useCallback } from 'react';
import { Card } from './ui/Card';
import { useTranslation } from '../i18n';

interface FileUploadProps {
    onFileSelect: (file: File) => void;
    disabled: boolean;
}

const UploadIcon = () => (
    <svg className="w-12 h-12 mx-auto text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);


export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, disabled }) => {
    const [isDragging, setIsDragging] = useState(false);
    const { t } = useTranslation();

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setIsDragging(true);
        } else if (e.type === "dragleave") {
            setIsDragging(false);
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    }, [onFileSelect]);
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
        }
    };

    return (
        <Card className="h-full flex flex-col items-center justify-center">
            <div
                className={`w-full h-full flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-md transition-colors ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-700'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
            >
                <input type="file" id="file-upload" className="sr-only" accept=".zip" onChange={handleChange} disabled={disabled} />
                <label htmlFor="file-upload" className="w-full text-center cursor-pointer">
                    <UploadIcon />
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        <span className="font-semibold text-blue-600 dark:text-blue-400">{t('fileUpload.callToAction')}</span> {t('fileUpload.orDragDrop')}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{t('fileUpload.hint')}</p>
                </label>
            </div>
        </Card>
    );
};
